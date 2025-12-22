import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, Protocol, LogDrivers, Secret } from 'aws-cdk-lib/aws-ecs'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { ApplicationLoadBalancer, ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Vpc, SecurityGroup, Peer, Port, SubnetType } from 'aws-cdk-lib/aws-ec2'
import { Repository } from 'aws-cdk-lib/aws-ecr'
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'

interface Props extends cdk.StackProps { vpc: Vpc; db: DatabaseInstance }

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const cluster = new Cluster(this, 'Cluster', { vpc: props.vpc, clusterName: 'property-expenses' })
    const task = new FargateTaskDefinition(this, 'Task', { cpu: 256, memoryLimitMiB: 512 })
    const logGroup = new LogGroup(this, 'Logs', { retention: RetentionDays.ONE_WEEK })

    const dbUrlParam = StringParameter.fromSecureStringParameterAttributes(this, 'DbUrl', {
      parameterName: '/property-expenses/DATABASE_URL',
      version: 1,
    })

    task.addContainer('Api', {
      image: ContainerImage.fromEcrRepository(Repository.fromRepositoryName(this, 'Repo', 'property-expenses-api'), 'latest'),
      logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      environment: { PORT: '3000', NODE_ENV: 'production' },
      secrets: { DATABASE_URL: Secret.fromSsmParameter(dbUrlParam) },
    }).addPortMappings({ containerPort: 3000, protocol: Protocol.TCP })
    
    const albSg = new SecurityGroup(this, 'AlbSg', { vpc: props.vpc })
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80))
    const serviceSg = new SecurityGroup(this, 'ServiceSg', { vpc: props.vpc })
    serviceSg.addIngressRule(albSg, Port.tcp(3000))
    props.db.connections.allowDefaultPortFrom(serviceSg)

    const alb = new ApplicationLoadBalancer(this, 'Alb', { vpc: props.vpc, internetFacing: true, securityGroup: albSg })
    const listener = alb.addListener('Http', { port: 80, protocol: ApplicationProtocol.HTTP })
    const service = new FargateService(this, 'Service', {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      serviceName: 'api',
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
    })
    listener.addTargets('ApiTg', {
      port: 3000,
      targets: [service],
      protocol: ApplicationProtocol.HTTP,
      healthCheck: { path: '/api/healthz' },
    })
    new cdk.CfnOutput(this, 'AlbDns', { value: alb.loadBalancerDnsName })
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName })
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName })
    new cdk.CfnOutput(this, 'ServiceSecurityGroupId', { value: serviceSg.securityGroupId })
  }
}
