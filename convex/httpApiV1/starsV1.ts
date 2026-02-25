import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { requireApiTokenUser } from '../lib/apiTokenAuth'
import { applyRateLimit } from '../lib/httpRateLimit'
import { getPathSegments, json, text } from './shared'

export async function starsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/stars/')
  if (segments.length !== 1) return text('Not found', 404, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''

  // Authenticate first — keep auth errors isolated so DB/mutation failures
  // don't get misreported as 401 Unauthorized.
  const auth = await requireApiTokenUser(ctx, request).catch(() => null)
  if (!auth) return text('Unauthorized', 401, rate.headers)
  const { userId } = auth

  const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
  if (!skill) return text('Skill not found', 404, rate.headers)

  const result = await ctx.runMutation(internal.stars.addStarInternal, {
    userId,
    skillId: skill._id,
  })
  return json(result, 200, rate.headers)
}

export async function starsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/stars/')
  if (segments.length !== 1) return text('Not found', 404, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''

  // Authenticate first — keep auth errors isolated so DB/mutation failures
  // don't get misreported as 401 Unauthorized.
  const auth = await requireApiTokenUser(ctx, request).catch(() => null)
  if (!auth) return text('Unauthorized', 401, rate.headers)
  const { userId } = auth

  const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
  if (!skill) return text('Skill not found', 404, rate.headers)

  const result = await ctx.runMutation(internal.stars.removeStarInternal, {
    userId,
    skillId: skill._id,
  })
  return json(result, 200, rate.headers)
}
