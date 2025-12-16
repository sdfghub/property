import { Body, Controller, Get, Param, Post, Req, UseGuards, Delete, UploadedFile, UseInterceptors } from '@nestjs/common'
type UploadedFile = { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }
import { TemplateService } from './template.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { FileInterceptor } from '@nestjs/platform-express'

@Controller('communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get('periods/:periodCode/bill-templates')
  listBillTemplates(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.templates.listBillTemplates(communityId, periodCode, req.user?.roles ?? [])
  }

  @Post('periods/:periodCode/bill-templates/:code/state')
  saveBillTemplateState(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.templates.saveBillTemplateState(communityId, periodCode, code, req.user?.roles ?? [], {
      state: body.state,
      values: body.values,
    })
  }

  @Get('periods/:periodCode/bill-templates/:code/attachments')
  listBillAttachments(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Param('code') code: string, @Req() req: any) {
    return this.templates.listBillTemplateAttachments(communityId, periodCode, code, req.user?.roles ?? [])
  }

  @Post('periods/:periodCode/bill-templates/:code/attachments')
  @UseInterceptors(FileInterceptor('file'))
  uploadBillAttachment(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @UploadedFile() file: UploadedFile,
    @Req() req: any,
  ) {
    return this.templates.uploadBillTemplateAttachment(communityId, periodCode, code, req.user?.roles ?? [], file)
  }

  @Delete('periods/:periodCode/bill-templates/:code/attachments/:id')
  deleteBillAttachment(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.templates.deleteBillTemplateAttachment(communityId, periodCode, code, req.user?.roles ?? [], id)
  }

  @Get('periods/:periodCode/bill-templates/:code/attachments/:id/download')
  downloadBillAttachment(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.templates.downloadBillTemplateAttachment(communityId, periodCode, code, req.user?.roles ?? [], id)
  }

  @Get('periods/:periodCode/meter-templates')
  listMeterTemplates(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Req() req: any) {
    return this.templates.listMeterTemplates(communityId, periodCode, req.user?.roles ?? [])
  }

  @Post('periods/:periodCode/meter-templates/:code/state')
  saveMeterTemplateState(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.templates.saveMeterTemplateState(communityId, periodCode, code, req.user?.roles ?? [], {
      state: body.state,
      values: body.values,
    })
  }

  @Get('periods/:periodCode/meter-templates/:code/attachments')
  listMeterAttachments(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Param('code') code: string, @Req() req: any) {
    return this.templates.listMeterTemplateAttachments(communityId, periodCode, code, req.user?.roles ?? [])
  }

  @Post('periods/:periodCode/meter-templates/:code/attachments')
  @UseInterceptors(FileInterceptor('file'))
  uploadMeterAttachment(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @UploadedFile() file: UploadedFile,
    @Req() req: any,
  ) {
    return this.templates.uploadMeterTemplateAttachment(communityId, periodCode, code, req.user?.roles ?? [], file)
  }

  @Delete('periods/:periodCode/meter-templates/:code/attachments/:id')
  deleteMeterAttachment(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.templates.deleteMeterTemplateAttachment(communityId, periodCode, code, req.user?.roles ?? [], id)
  }

  @Get('periods/:periodCode/meter-templates/:code/attachments/:id/download')
  downloadMeterAttachment(
    @Param('communityId') communityId: string,
    @Param('periodCode') periodCode: string,
    @Param('code') code: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.templates.downloadMeterTemplateAttachment(communityId, periodCode, code, req.user?.roles ?? [], id)
  }

  @Get('periods/:periodCode/meters/:meterId')
  meterReading(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Param('meterId') meterId: string, @Req() req: any) {
    return this.templates.getMeterReading(communityId, periodCode, meterId, req.user?.roles ?? [])
  }

  @Post('periods/:periodCode/meters')
  upsertMeterReading(@Param('communityId') communityId: string, @Param('periodCode') periodCode: string, @Body() body: any, @Req() req: any) {
    return this.templates.upsertMeterReading(communityId, periodCode, req.user?.roles ?? [], {
      meterId: body.meterId,
      value: Number(body.value),
      origin: body.origin,
      estimated: !!body.estimated,
    })
  }
}
