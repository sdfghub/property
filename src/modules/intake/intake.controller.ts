import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { Feature } from '../../common/decorators/feature.decorator'
import { IntakePromptService } from './intake-prompt.service'
import { IntakeImportService } from './intake-import.service'
import { IntakeApplyService } from './intake-apply.service'
import { IntakeService, type ReviewInput } from './intake.service'

type UploadedFileShape = { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }
const MAX_JSON_BYTES = 10 * 1024 * 1024

// AI intake, v1 (manual loop): the app hands out a prompt pack, an external agent turns the zip into
// `intake-import/v1` JSON, the admin imports it here, reviews each proposal, and applies the approved
// ones. Admin-only, per-community feature flag `aiIntake`. See docs/intake.md.
@Controller('communities/:communityId/intake')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
@Feature('aiIntake')
export class IntakeController {
  constructor(
    private readonly prompt: IntakePromptService,
    private readonly importer: IntakeImportService,
    private readonly apply: IntakeApplyService,
    private readonly svc: IntakeService,
  ) {}

  /** The prompt pack. `format=md` (default) streams markdown; `format=json` returns {prompt, schema, catalogue, example}. */
  @Get('prompt')
  async prompt_(@Param('communityId') c: string, @Query('periodCode') periodCode: string, @Query('format') format: string | undefined, @Res({ passthrough: true }) res: any) {
    if (!periodCode) throw new BadRequestException('periodCode is required')
    const pack = await this.prompt.buildPack(c, periodCode)
    if (format === 'json') return pack
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="intake-prompt-${pack.catalogue.community.code}-${periodCode}.md"`)
    return pack.prompt
  }

  /** Catalogue for the review UI's selects — same object the prompt is rendered from. */
  @Get('context')
  context(@Param('communityId') c: string, @Query('periodCode') periodCode: string) {
    if (!periodCode) throw new BadRequestException('periodCode is required')
    return this.svc.context(c, periodCode)
  }

  @Get('batches')
  list(@Param('communityId') c: string, @Query('limit') limit?: string) {
    return this.svc.listBatches(c, limit ? Number(limit) : 20)
  }

  /** Import an agent payload: either JSON body `{ periodCode?, payload }` or multipart `file` (.json). */
  @Post('batches')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_JSON_BYTES } }))
  async create(@Param('communityId') c: string, @Body() body: any, @UploadedFile() file: UploadedFileShape | undefined, @Req() req: any) {
    let raw: unknown
    let sourceFileName: string | null = null
    if (file?.buffer?.length) {
      try {
        raw = JSON.parse(file.buffer.toString('utf8'))
      } catch (e: any) {
        throw new BadRequestException({ message: `Uploaded file is not valid JSON: ${e?.message ?? e}`, issues: [] })
      }
      sourceFileName = file.originalname ?? null
    } else if (body && typeof body === 'object' && body.payload) {
      raw = typeof body.payload === 'string' ? safeParse(body.payload) : body.payload
    } else if (body && typeof body === 'object' && body.records) {
      raw = body
    } else {
      throw new BadRequestException({ message: 'Send the agent JSON as multipart `file` or as `{ payload }`', issues: [] })
    }
    const expectedPeriodCode = typeof body?.periodCode === 'string' && body.periodCode ? body.periodCode : undefined
    const batch = await this.importer.importPayload(c, raw, {
      createdBy: req.user?.email ?? req.user?.id ?? req.user?.sub ?? null,
      sourceFileName,
      expectedPeriodCode,
    })
    return this.svc.getBatch(c, batch.id)
  }

  /** Parse + check without persisting — lets the UI show blockers before committing to a batch. */
  @Post('batches/check')
  async check(@Param('communityId') c: string, @Body() body: any) {
    const raw = body?.payload ?? body
    const { payload, records } = await this.importer.checkPayload(c, typeof raw === 'string' ? safeParse(raw) : raw)
    return { periodCode: payload.periodCode, records }
  }

  @Get('batches/:batchId')
  get(@Param('communityId') c: string, @Param('batchId') batchId: string) {
    return this.svc.getBatch(c, batchId)
  }

  @Post('batches/:batchId/recheck')
  recheck(@Param('communityId') c: string, @Param('batchId') batchId: string) {
    return this.svc.recheck(c, batchId)
  }

  @Patch('batches/:batchId/records/:recordId')
  review(@Param('communityId') c: string, @Param('batchId') batchId: string, @Param('recordId') recordId: string, @Body() body: ReviewInput & { action?: 'APPROVE' | 'SKIP' | 'REOPEN' }) {
    const { action, ...input } = body ?? {}
    if (action === 'SKIP') return this.svc.skip(c, batchId, recordId)
    if (action === 'REOPEN') return this.svc.reopen(c, batchId, recordId)
    if (action === 'APPROVE') {
      return (async () => {
        if (input.invoice !== undefined || input.mapping !== undefined) await this.svc.review(c, batchId, recordId, input)
        return this.svc.approve(c, batchId, recordId, input.overrides)
      })()
    }
    return this.svc.review(c, batchId, recordId, input)
  }

  @Post('batches/:batchId/apply')
  applyBatch(@Param('communityId') c: string, @Param('batchId') batchId: string, @Body() body: { recordIds?: string[] } | undefined, @Req() req: any) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : []
    return this.apply.applyBatch(c, batchId, roles, body?.recordIds)
  }

  @Delete('batches/:batchId')
  remove(@Param('communityId') c: string, @Param('batchId') batchId: string) {
    return this.svc.deleteBatch(c, batchId)
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch (e: any) {
    throw new BadRequestException({ message: `payload is not valid JSON: ${e?.message ?? e}`, issues: [] })
  }
}
