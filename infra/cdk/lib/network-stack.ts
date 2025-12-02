import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'

export class NetworkStack extends cdk.Stack {
  public readonly vpc: Vpc
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC },
        { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS }
      ]
    })
  }
}
