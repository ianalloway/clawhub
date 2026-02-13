/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('./_generated/api', () => ({
  internal: {
    maintenance: {
      getSkillBackfillPageInternal: Symbol('getSkillBackfillPageInternal'),
      applySkillBackfillPatchInternal: Symbol('applySkillBackfillPatchInternal'),
      backfillSkillSummariesInternal: Symbol('backfillSkillSummariesInternal'),
      getSkillFingerprintBackfillPageInternal: Symbol('getSkillFingerprintBackfillPageInternal'),
      applySkillFingerprintBackfillPatchInternal: Symbol(
        'applySkillFingerprintBackfillPatchInternal',
      ),
      backfillSkillFingerprintsInternal: Symbol('backfillSkillFingerprintsInternal'),
      getEmptySkillCleanupPageInternal: Symbol('getEmptySkillCleanupPageInternal'),
      applyEmptySkillCleanupInternal: Symbol('applyEmptySkillCleanupInternal'),
      nominateUserForEmptySkillSpamInternal: Symbol('nominateUserForEmptySkillSpamInternal'),
      cleanupEmptySkillsInternal: Symbol('cleanupEmptySkillsInternal'),
    },
    skills: {
      getVersionByIdInternal: Symbol('skills.getVersionByIdInternal'),
      getOwnerSkillActivityInternal: Symbol('skills.getOwnerSkillActivityInternal'),
    },
    users: {
      getByIdInternal: Symbol('users.getByIdInternal'),
    },
  },
}))

const {
  backfillSkillFingerprintsInternalHandler,
  backfillSkillSummariesInternalHandler,
  cleanupEmptySkillsInternalHandler,
} = await import('./maintenance')
const { internal } = await import('./_generated/api')

function makeBlob(text: string) {
  return { text: () => Promise.resolve(text) } as unknown as Blob
}

describe('maintenance backfill', () => {
  it('repairs summary + parsed by reparsing SKILL.md', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: 'ok',
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          skillSummary: '>',
          versionParsed: { frontmatter: { description: '>' } },
          readmeStorageId: 'storage:1',
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn().mockResolvedValue({ ok: true })
    const storageGet = vi
      .fn()
      .mockResolvedValue(makeBlob(`---\ndescription: >\n  Hello\n  world.\n---\nBody`))

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.skillsScanned).toBe(1)
    expect(result.stats.skillsPatched).toBe(1)
    expect(result.stats.versionsPatched).toBe(1)
    expect(runMutation).toHaveBeenCalledTimes(1)
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: 'skills:1',
      versionId: 'skillVersions:1',
      summary: 'Hello world.',
      parsed: {
        frontmatter: { description: 'Hello world.' },
        metadata: undefined,
        clawdis: undefined,
      },
    })
  })

  it('dryRun does not patch', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: 'ok',
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          skillSummary: '>',
          versionParsed: { frontmatter: { description: '>' } },
          readmeStorageId: 'storage:1',
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn()
    const storageGet = vi.fn().mockResolvedValue(makeBlob(`---\ndescription: Hello\n---\nBody`))

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.skillsPatched).toBe(1)
    expect(runMutation).not.toHaveBeenCalled()
  })

  it('counts missing storage blob', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: 'ok',
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: 'storage:missing',
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn()
    const storageGet = vi.fn().mockResolvedValue(null)

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    )

    expect(result.stats.missingStorageBlob).toBe(1)
    expect(runMutation).not.toHaveBeenCalled()
  })
})

describe('maintenance fingerprint backfill', () => {
  it('backfills fingerprint field and inserts index entry', async () => {
    const { hashSkillFiles } = await import('./lib/skills')
    const expected = await hashSkillFiles([{ path: 'SKILL.md', sha256: 'abc' }])

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          versionFingerprint: undefined,
          files: [{ path: 'SKILL.md', sha256: 'abc' }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn().mockResolvedValue({ ok: true })

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.versionsScanned).toBe(1)
    expect(result.stats.versionsPatched).toBe(1)
    expect(result.stats.fingerprintsInserted).toBe(1)
    expect(result.stats.fingerprintMismatches).toBe(0)
    expect(runMutation).toHaveBeenCalledTimes(1)
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: 'skillVersions:1',
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: [],
    })
  })

  it('dryRun does not patch', async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          versionFingerprint: undefined,
          files: [{ path: 'SKILL.md', sha256: 'abc' }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn()

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.versionsPatched).toBe(1)
    expect(result.stats.fingerprintsInserted).toBe(1)
    expect(runMutation).not.toHaveBeenCalled()
  })

  it('patches missing version fingerprint without touching correct entries', async () => {
    const { hashSkillFiles } = await import('./lib/skills')
    const expected = await hashSkillFiles([{ path: 'SKILL.md', sha256: 'abc' }])

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          versionFingerprint: undefined,
          files: [{ path: 'SKILL.md', sha256: 'abc' }],
          existingEntries: [{ id: 'skillVersionFingerprints:1', fingerprint: expected }],
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn().mockResolvedValue({ ok: true })

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.versionsPatched).toBe(1)
    expect(result.stats.fingerprintsInserted).toBe(0)
    expect(result.stats.fingerprintMismatches).toBe(0)
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: 'skillVersions:1',
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: false,
      existingEntryIds: [],
    })
  })

  it('replaces mismatched fingerprint entries', async () => {
    const { hashSkillFiles } = await import('./lib/skills')
    const expected = await hashSkillFiles([{ path: 'SKILL.md', sha256: 'abc' }])

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: 'skills:1',
          versionId: 'skillVersions:1',
          versionFingerprint: 'wrong',
          files: [{ path: 'SKILL.md', sha256: 'abc' }],
          existingEntries: [{ id: 'skillVersionFingerprints:1', fingerprint: 'wrong' }],
        },
      ],
      cursor: null,
      isDone: true,
    })

    const runMutation = vi.fn().mockResolvedValue({ ok: true })

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.fingerprintMismatches).toBe(1)
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: 'skillVersions:1',
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: ['skillVersionFingerprints:1'],
    })
  })
})

describe('maintenance empty skill cleanup', () => {
  it('dryRun detects empty skills and returns nominations', async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: 'skills:1',
              slug: 'spam-skill',
              ownerUserId: 'users:1',
              latestVersionId: 'skillVersions:1',
              softDeletedAt: undefined,
              summary: 'Expert guidance for spam-skill.',
            },
          ],
          cursor: null,
          isDone: true,
        }
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          _id: 'skillVersions:1',
          files: [{ path: 'SKILL.md', size: 120, storageId: 'storage:1' }],
        }
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: 'users:1', handle: 'spammer', _creationTime: Date.now() }
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return []
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`)
    })

    const runMutation = vi.fn()
    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      )

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1, nominationThreshold: 1 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.emptyDetected).toBe(1)
    expect(result.stats.skillsDeleted).toBe(0)
    expect(result.nominations).toEqual([
      {
        userId: 'users:1',
        handle: 'spammer',
        emptySkillCount: 1,
        sampleSlugs: ['spam-skill'],
      },
    ])
    expect(runMutation).not.toHaveBeenCalled()
  })

  it('apply mode deletes empty skills and records nominations', async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: 'skills:1',
              slug: 'spam-a',
              ownerUserId: 'users:1',
              latestVersionId: 'skillVersions:1',
              summary: 'Expert guidance for spam-a.',
            },
            {
              skillId: 'skills:2',
              slug: 'spam-b',
              ownerUserId: 'users:1',
              latestVersionId: 'skillVersions:2',
              summary: 'Expert guidance for spam-b.',
            },
          ],
          cursor: null,
          isDone: true,
        }
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          files: [{ path: 'SKILL.md', size: 120, storageId: 'storage:1' }],
        }
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: 'users:1', handle: 'spammer', _creationTime: Date.now() }
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return []
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`)
    })

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.applyEmptySkillCleanupInternal) {
        return { deleted: true }
      }
      if (endpoint === internal.maintenance.nominateUserForEmptySkillSpamInternal) {
        return { created: true }
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`)
    })

    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      )

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, nominationThreshold: 2 },
    )

    expect(result.ok).toBe(true)
    expect(result.stats.emptyDetected).toBe(2)
    expect(result.stats.skillsDeleted).toBe(2)
    expect(result.stats.nominationsCreated).toBe(1)
    expect(runMutation).toHaveBeenCalledWith(
      internal.maintenance.nominateUserForEmptySkillSpamInternal,
      expect.objectContaining({
        userId: 'users:1',
        emptySkillCount: 2,
      }),
    )
  })
})
