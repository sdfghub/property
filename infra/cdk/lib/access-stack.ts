import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  SecurityGroup,
  Vpc,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2'
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'

interface Props extends cdk.StackProps {
  vpc: Vpc
  bastionSecurityGroup: SecurityGroup
}

export class AccessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const bastionRole = new Role(this, 'BastionRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    })

    const bastion = new Instance(this, 'Bastion', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      machineImage: MachineImage.latestAmazonLinux2023(),
      securityGroup: props.bastionSecurityGroup,
      role: bastionRole,
    })

    new cdk.CfnOutput(this, 'BastionInstanceId', {
      value: bastion.instanceId,
    })
  }
}
