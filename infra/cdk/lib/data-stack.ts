import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion, StorageType } from 'aws-cdk-lib/aws-rds'
import {
  InstanceType,
  InstanceClass,
  InstanceSize,
  Vpc,
  SubnetType,
  SecurityGroup,
  Port,
} from 'aws-cdk-lib/aws-ec2'

interface Props extends cdk.StackProps { vpc: Vpc }

export class DataStack extends cdk.Stack {
  public readonly db: DatabaseInstance
  public readonly dbSecurityGroup: SecurityGroup
  public readonly bastionSecurityGroup: SecurityGroup
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const dbSg = new SecurityGroup(this, 'DbSg', { vpc: props.vpc })
    this.dbSecurityGroup = dbSg
    const bastionSg = new SecurityGroup(this, 'BastionSg', {
      vpc: props.vpc,
      allowAllOutbound: false,
    })
    this.bastionSecurityGroup = bastionSg
    bastionSg.addEgressRule(dbSg, Port.tcp(5432))
    dbSg.addIngressRule(bastionSg, Port.tcp(5432))
    this.db = new DatabaseInstance(this, 'Postgres', {
      vpc: props.vpc,
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 }),
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      allocatedStorage: 20,
      storageType: StorageType.GP3,
      securityGroups: [dbSg],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      publiclyAccessible: false,
      credentials: { username: 'postgres' }
    })
    new cdk.CfnOutput(this, 'DbSecurityGroupId', {
      value: dbSg.securityGroupId,
    })
    new cdk.CfnOutput(this, 'BastionSecurityGroupId', {
      value: bastionSg.securityGroupId,
    })
  }
}
