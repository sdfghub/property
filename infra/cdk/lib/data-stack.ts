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
  Peer,
  Port,
  Instance,
  MachineImage,
} from 'aws-cdk-lib/aws-ec2'
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam'

interface Props extends cdk.StackProps { vpc: Vpc }

export class DataStack extends cdk.Stack {
  public readonly db: DatabaseInstance
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const bastionSg = new SecurityGroup(this, 'BastionSg', { vpc: props.vpc })
    const dbSg = new SecurityGroup(this, 'DbSg', { vpc: props.vpc })
    dbSg.addIngressRule(bastionSg, Port.tcp(5432))
    bastionSg.addEgressRule(Peer.anyIpv4(), Port.tcp(5432))

    const bastionRole = new Role(this, 'BastionRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    })

    const bastion = new Instance(this, 'Bastion', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
      machineImage: MachineImage.latestAmazonLinux2023(),
      securityGroup: bastionSg,
      role: bastionRole,
    })
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

    new cdk.CfnOutput(this, 'BastionInstanceId', {
      value: bastion.instanceId,
    })
    new cdk.CfnOutput(this, 'BastionSecurityGroupId', {
      value: bastionSg.securityGroupId,
    })
  }
}
