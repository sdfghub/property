import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type Mode = 'INDEX' | 'CONSUMPTION'

/**
 * Per-community, per-measure-type meter reading mode.
 * INDEX = the entered value is a cumulative meter reading (consumption = reading − previous).
 * CONSUMPTION (default) = the entered value is the period consumption.
 * Stored in Community.measureModes JSON: { "<typeCode>": "INDEX" | "CONSUMPTION" }.
 */
@Injectable()
export class MeasureModeService {
  constructor(private readonly prisma: PrismaService) {}

  private async community(ref: string) {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: ref }, { code: ref }] },
      select: { id: true, code: true, measureModes: true },
    })
    if (!c) throw new NotFoundException('Community not found')
    return c
  }

  /** Measure types this community actually meters, each with its resolved mode. */
  async get(ref: string) {
    const c = await this.community(ref)
    const modes = (c.measureModes as Record<string, string>) || {}
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select distinct mt.code, mt.name, mt.unit
         from meter m
         join measure_type mt on mt.code = m.type_code
        where (m.scope_type = 'COMMUNITY' and m.scope_code = $1)
           or (m.scope_type = 'UNIT' and m.scope_code in (select code from unit where community_id = $2))
        order by mt.code`,
      c.code, c.id,
    )
    return {
      types: rows.map((r) => ({
        code: r.code,
        name: r.name,
        unit: r.unit,
        mode: (modes[r.code] === 'INDEX' ? 'INDEX' : 'CONSUMPTION') as Mode,
      })),
    }
  }

  /** Set modes. Body is { "<typeCode>": "INDEX"|"CONSUMPTION", ... } (or { modes: {...} }). */
  async set(ref: string, body: any) {
    const c = await this.community(ref)
    const current = (c.measureModes as Record<string, string>) || {}
    const patch = (body?.modes ?? body ?? {}) as Record<string, any>
    const next = { ...current }
    for (const [k, v] of Object.entries(patch)) {
      if (v === 'INDEX' || v === 'CONSUMPTION') next[k] = v
    }
    await this.prisma.community.update({ where: { id: c.id }, data: { measureModes: next as any } })
    return { modes: next }
  }
}
