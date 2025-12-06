import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, Protocol, LogDrivers } from 'aws-cdk-lib/aws-ecs'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { ApplicationLoadBalancer, ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Vpc, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2'
import { Repository } from 'aws-cdk-lib/aws-ecr'
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds'

interface Props extends cdk.StackProps { vpc: Vpc; db: DatabaseInstance }

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const cluster = new Cluster(this, 'Cluster', { vpc: props.vpc })
    const task = new FargateTaskDefinition(this, 'Task', { cpu: 256, memoryLimitMiB: 512 })
    const logGroup = new LogGroup(this, 'Logs', { retention: RetentionDays.ONE_WEEK })

    task.addContainer('Api', {
      image: ContainerImage.fromEcrRepository(Repository.fromRepositoryName(this, 'Repo', 'property-expenses-api'), 'latest'),
      logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      environment: { PORT: '3000', NODE_ENV: 'production' }
    }).addPortMappings({ containerPort: 3000, protocol: Protocol.TCP })
    
    const sg = new SecurityGroup(this, 'AlbSg', { vpc: props.vpc })
    sg.addIngressRule(Peer.anyIpv4(), Port.tcp(80))
    const alb = new ApplicationLoadBalancer(this, 'Alb', { vpc: props.vpc, internetFacing: true, securityGroup: sg })
    const listener = alb.addListener('Http', { port: 80, protocol: ApplicationProtocol.HTTP })
    const service = new FargateService(this, 'Service', { cluster, taskDefinition: task, desiredCount: 1 })
    listener.addTargets('ApiTg', { port: 80, targets: [service], protocol: ApplicationProtocol.HTTP, healthCheck: { path: '/healthz' } })
    new cdk.CfnOutput(this, 'AlbDns', { value: alb.loadBalancerDnsName })
  }
}
