import { Module } from '@nestjs/common'
import { MetadataController } from './metadata.controller'

@Module({ controllers: [MetadataController] })
export class MetadataModule {}
