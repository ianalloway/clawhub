import { v } from 'convex/values'
import { internal } from './_generated/api'
import { action, internalAction } from './_generated/server'
import { buildDeterministicZip } from './lib/skillZip'

const BENIGN_VERDICTS = new Set(['benign', 'clean'])
const MALICIOUS_VERDICTS = new Set(['malicious'])
const SUSPICIOUS_VERDICTS = new Set(['suspicious'])

function normalizeVerdict(value?: string) {
  return value?.trim().toLowerCase() ?? ''
}

function verdictToStatus(verdict: string) {
  if (BENIGN_VERDICTS.has(verdict)) return 'clean'
  if (MALICIOUS_VERDICTS.has(verdict)) return 'malicious'
  if (SUSPICIOUS_VERDICTS.has(verdict)) return 'suspicious'
  return 'pending'
}

type VTAIResult = {
  category: string
  verdict: string
  analysis?: string
  source?: string
}

type VTFileResponse = {
  data: {
    attributes: {
      sha256: string
      crowdsourced_ai_results?: VTAIResult[]
      last_analysis_stats?: {
        malicious: number
        suspicious: number
        undetected: number
        harmless: number
      }
    }
  }
}

export const fetchResults = action({
  args: {
    sha256hash: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (!args.sha256hash) {
      return { status: 'not_found' }
    }

    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      return { status: 'error', message: 'VT_API_KEY not configured' }
    }

    try {
      const response = await fetch(`https://www.virustotal.com/api/v3/files/${args.sha256hash}`, {
        method: 'GET',
        headers: {
          'x-apikey': apiKey,
        },
      })

      if (response.status === 404) {
        return { status: 'not_found' }
      }

      if (!response.ok) {
        return { status: 'error' }
      }

      const data = (await response.json()) as VTFileResponse
      const aiResult = data.data.attributes.crowdsourced_ai_results?.find(
        (r) => r.category === 'code_insight',
      )

      const stats = data.data.attributes.last_analysis_stats
      let status = 'pending'

      if (aiResult?.verdict) {
        // Prioritize AI Analysis (Code Insight)
        status = verdictToStatus(normalizeVerdict(aiResult.verdict))
      } else if (stats) {
        // Fallback to AV engines
        if (stats.malicious > 0) {
          status = 'malicious'
        } else if (stats.suspicious > 0) {
          status = 'suspicious'
        } else if (stats.harmless > 0) {
          status = 'clean'
        }
      }

      return {
        status,
        source: aiResult?.verdict ? 'code_insight' : 'engines',
        url: `https://www.virustotal.com/gui/file/${args.sha256hash}`,
        metadata: {
          aiVerdict: aiResult?.verdict,
          aiAnalysis: aiResult?.analysis,
          aiSource: aiResult?.source,
          stats: stats,
        },
      }
    } catch (error) {
      console.error('Error fetching VT results:', error)
      return { status: 'error' }
    }
  },
})

export const scanWithVirusTotal = internalAction({
  args: {
    versionId: v.id('skillVersions'),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('VT_API_KEY not configured, skipping scan')
      return
    }

    // Get the version details and files
    const version = await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })

    if (!version) {
      console.error(`Version ${args.versionId} not found for scanning`)
      return
    }

    // Fetch skill info for _meta.json
    const skill = await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })
    if (!skill) {
      console.error(`Skill ${version.skillId} not found for scanning`)
      return
    }

    // Build deterministic ZIP with stable meta (no version history).
    const entries: Array<{ path: string; bytes: Uint8Array }> = []
    for (const file of version.files) {
      const content = await ctx.storage.get(file.storageId)
      if (content) {
        const buffer = new Uint8Array(await content.arrayBuffer())
        entries.push({ path: file.path, bytes: buffer })
      }
    }

    if (entries.length === 0) {
      console.warn(`No files found for version ${args.versionId}, skipping scan`)
      return
    }

    const zipArray = buildDeterministicZip(entries, {
      ownerId: String(skill.ownerUserId),
      slug: skill.slug,
      version: version.version,
      publishedAt: version.createdAt,
    })

    // Calculate SHA-256 of the ZIP (this hash includes _meta.json)
    const hashBuffer = await crypto.subtle.digest('SHA-256', zipArray)
    const sha256hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Update version with hash
    await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
      versionId: args.versionId,
      sha256hash,
    })

    // Check if file already exists in VT and has AI analysis
    try {
      const existingFile = await checkExistingFile(apiKey, sha256hash)

      if (existingFile) {
        const aiResult = existingFile.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (aiResult) {
          // File exists and has AI analysis - use the verdict
          const verdict = normalizeVerdict(aiResult.verdict)
          const status = verdictToStatus(verdict)
          const isSafe = status === 'clean'

          console.log(
            `Version ${args.versionId} found in VT with AI analysis. Hash: ${sha256hash}. Verdict: ${verdict}`,
          )

          if (isSafe) {
            await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
              sha256hash,
              scanner: 'vt',
              status: 'clean',
              moderationStatus: 'active',
            })
          } else if (status === 'malicious' || status === 'suspicious') {
            await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
              sha256hash,
              scanner: 'vt',
              status,
              moderationStatus: 'hidden',
            })
          }
          return
        }

        // File exists but no AI analysis - need to upload for fresh scan
        console.log(
          `Version ${args.versionId} found in VT but no AI analysis. Hash: ${sha256hash}. Uploading...`,
        )
      } else {
        console.log(`Version ${args.versionId} not found in VT. Hash: ${sha256hash}. Uploading...`)
      }
    } catch (error) {
      console.error('Error checking existing file in VT:', error)
      // Continue to upload even if check fails
    }

    // Upload file to VirusTotal (v3 API)
    const formData = new FormData()
    const blob = new Blob([zipArray], { type: 'application/zip' })
    formData.append('file', blob, 'skill.zip')

    try {
      const response = await fetch('https://www.virustotal.com/api/v3/files', {
        method: 'POST',
        headers: {
          'x-apikey': apiKey,
        },
        body: formData,
      })

      if (!response.ok) {
        const error = await response.text()
        console.error('VirusTotal upload error:', error)
        return
      }

      const result = (await response.json()) as { data: { id: string } }
      console.log(
        `Successfully uploaded version ${args.versionId} to VT. Hash: ${sha256hash}. Analysis ID: ${result.data.id}`,
      )
    } catch (error) {
      console.error('Failed to upload to VirusTotal:', error)
    }
  },
})

/**
 * Poll for pending scans and update skill moderation status
 * Called by cron job to check VT results for skills awaiting scan
 */
export const pollPendingScans = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:pollPendingScans] VT_API_KEY not configured, skipping')
      return { processed: 0, updated: 0, healthy: false }
    }

    const batchSize = args.batchSize ?? 10

    // Check queue health
    const health = await ctx.runQuery(internal.skills.getScanQueueHealthInternal, {})
    if (!health.healthy) {
      console.warn(
        `[vt:pollPendingScans] QUEUE UNHEALTHY: ${health.queueSize} pending, ${health.veryStaleCount} stale >24h, oldest ${health.oldestAgeMinutes}m`,
      )
    }

    // Get skills pending scan (randomized selection)
    const pendingSkills = await ctx.runQuery(internal.skills.getPendingScanSkillsInternal, {
      limit: batchSize,
    })

    if (pendingSkills.length === 0) {
      return { processed: 0, updated: 0, healthy: health.healthy, queueSize: health.queueSize }
    }

    console.log(
      `[vt:pollPendingScans] Checking ${pendingSkills.length} pending skills (queue: ${health.queueSize})`,
    )

    let updated = 0
    for (const { skillId, versionId, sha256hash } of pendingSkills) {
      if (!sha256hash) {
        console.log(
          `[vt:pollPendingScans] Skill ${skillId} version ${versionId} has no hash, skipping`,
        )
        continue
      }

      try {
        const vtResult = await checkExistingFile(apiKey, sha256hash)
        if (!vtResult) {
          console.log(`[vt:pollPendingScans] Hash ${sha256hash} not found in VT yet`)
          continue
        }

        const aiResult = vtResult.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (!aiResult) {
          // No Code Insight - trigger a rescan to get it
          console.log(
            `[vt:pollPendingScans] Hash ${sha256hash} has no Code Insight, requesting rescan`,
          )
          await requestRescan(apiKey, sha256hash)
          continue
        }

        // We have a verdict - update the skill
        const verdict = normalizeVerdict(aiResult.verdict)
        const status = verdictToStatus(verdict)

        console.log(
          `[vt:pollPendingScans] Hash ${sha256hash} verdict: ${verdict} -> status: ${status}`,
        )

        await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
          sha256hash,
          scanner: 'vt',
          status,
        })
        updated++
      } catch (error) {
        console.error(`[vt:pollPendingScans] Error checking hash ${sha256hash}:`, error)
      }
    }

    console.log(`[vt:pollPendingScans] Processed ${pendingSkills.length}, updated ${updated}`)
    return {
      processed: pendingSkills.length,
      updated,
      healthy: health.healthy,
      queueSize: health.queueSize,
    }
  },
})

/**
 * Check if a file already exists in VirusTotal by hash
 */
async function checkExistingFile(
  apiKey: string,
  sha256hash: string,
): Promise<VTFileResponse | null> {
  const response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256hash}`, {
    method: 'GET',
    headers: {
      'x-apikey': apiKey,
    },
  })

  if (response.status === 404) {
    // File not found in VT
    return null
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`VT API error: ${response.status} - ${error}`)
  }

  return (await response.json()) as VTFileResponse
}

/**
 * Request a rescan of a file to trigger Code Insight analysis
 */
async function requestRescan(apiKey: string, sha256hash: string): Promise<boolean> {
  try {
    const response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256hash}/analyse`, {
      method: 'POST',
      headers: {
        'x-apikey': apiKey,
      },
    })

    if (!response.ok) {
      console.error(`[vt:requestRescan] Failed for ${sha256hash}: ${response.status}`)
      return false
    }

    return true
  } catch (error) {
    console.error(`[vt:requestRescan] Error for ${sha256hash}:`, error)
    return false
  }
}

/**
 * Backfill function to process ALL pending skills at once
 * Run manually to clear backlog
 */
export const backfillPendingScans = internalAction({
  args: {
    triggerRescans: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:backfill] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const triggerRescans = args.triggerRescans ?? true

    // Get ALL pending skills (no limit)
    const pendingSkills = await ctx.runQuery(internal.skills.getPendingScanSkillsInternal, {
      limit: 10000,
    })

    console.log(`[vt:backfill] Found ${pendingSkills.length} pending skills`)

    let updated = 0
    let rescansRequested = 0
    let noHash = 0
    let notInVT = 0
    let errors = 0

    for (const { sha256hash } of pendingSkills) {
      if (!sha256hash) {
        noHash++
        continue
      }

      try {
        const vtResult = await checkExistingFile(apiKey, sha256hash)

        if (!vtResult) {
          notInVT++
          continue
        }

        const aiResult = vtResult.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (!aiResult) {
          if (triggerRescans) {
            await requestRescan(apiKey, sha256hash)
            rescansRequested++
          }
          continue
        }

        // We have a verdict - update the skill
        const verdict = normalizeVerdict(aiResult.verdict)
        const status = verdictToStatus(verdict)

        await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
          sha256hash,
          scanner: 'vt',
          status,
        })
        updated++
      } catch (error) {
        console.error(`[vt:backfill] Error for ${sha256hash}:`, error)
        errors++
      }
    }

    const result = {
      total: pendingSkills.length,
      updated,
      rescansRequested,
      noHash,
      notInVT,
      errors,
      remaining: pendingSkills.length - updated,
    }

    console.log('[vt:backfill] Complete:', result)
    return result
  },
})
