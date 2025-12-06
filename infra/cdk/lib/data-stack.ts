import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion, StorageType } from 'aws-cdk-lib/aws-rds'
import { InstanceType, InstanceClass, InstanceSize, Vpc, SubnetType, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2'

interface Props extends cdk.StackProps { vpc: Vpc }

export class DataStack extends cdk.Stack {
  public readonly db: DatabaseInstance
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const sg = new SecurityGroup(this, 'DbSg', { vpc: props.vpc })
    sg.addIngressRule(Peer.anyIpv4(), Port.tcp(5432))
    this.db = new DatabaseInstance(this, 'Postgres', {
      vpc: props.vpc,
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 }),
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      allocatedStorage: 20,
      storageType: StorageType.GP3,
      securityGroups: [sg],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      publiclyAccessible: false,
      credentials: { username: 'postgres' }
    })
  }
}
