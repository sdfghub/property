#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { NetworkStack } from '../lib/network-stack'
import { DataStack } from '../lib/data-stack'
import { AppStack } from '../lib/app-stack'
import { FrontendStack } from '../lib/frontend-stack'
import { AccessStack } from '../lib/access-stack'

const app = new cdk.App()
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
const network = new NetworkStack(app, 'PropertyExpenses-Network', { env })
const data = new DataStack(app, 'PropertyExpenses-Data', { env, vpc: network.vpc })
new AccessStack(app, 'PropertyExpenses-Access', { env, vpc: network.vpc, dbSecurityGroup: data.dbSecurityGroup })
new AppStack(app, 'PropertyExpenses-App', { env, vpc: network.vpc, db: data.db })
new FrontendStack(app, 'PropertyExpenses-Frontend', { env })
