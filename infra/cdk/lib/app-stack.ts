import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, Protocol, LogDrivers, Secret } from 'aws-cdk-lib/aws-ecs'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { ApplicationLoadBalancer, ApplicationProtocol, ListenerAction } from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import { Vpc, SecurityGroup, Peer, Port, SubnetType, CfnSecurityGroupIngress } from 'aws-cdk-lib/aws-ec2'
import { Repository } from 'aws-cdk-lib/aws-ecr'
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'

interface Props extends cdk.StackProps {
  vpc: Vpc
  db: DatabaseInstance
  dbSecurityGroup: SecurityGroup
}

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
    const fcmParam = StringParameter.fromSecureStringParameterAttributes(this, 'FcmServiceAccount', {
      parameterName: '/property-expenses/FCM_SERVICE_ACCOUNT_JSON',
      version: 1,
    })

    const appVersion = process.env.APP_VERSION || this.node.tryGetContext('appVersion')
    const corsOrigins = process.env.CORS_ORIGINS || this.node.tryGetContext('corsOrigins')
    const environment: Record<string, string> = { PORT: '3000', NODE_ENV: 'production' }
    if (appVersion) {
      environment.APP_VERSION = appVersion
    }
    if (corsOrigins) {
      environment.CORS_ORIGINS = corsOrigins
    }
    task.addContainer('Api', {
      image: ContainerImage.fromEcrRepository(Repository.fromRepositoryName(this, 'Repo', 'property-expenses-api'), 'latest'),
      logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      environment,
      secrets: {
        DATABASE_URL: Secret.fromSsmParameter(dbUrlParam),
        FCM_SERVICE_ACCOUNT_JSON: Secret.fromSsmParameter(fcmParam),
      },
    }).addPortMappings({ containerPort: 3000, protocol: Protocol.TCP })
    
    const albSg = new SecurityGroup(this, 'AlbSg', { vpc: props.vpc })
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80))
    const serviceSg = new SecurityGroup(this, 'ServiceSg', { vpc: props.vpc })
    serviceSg.addIngressRule(albSg, Port.tcp(3000))
    new CfnSecurityGroupIngress(this, 'ServiceDbIngress', {
      groupId: props.dbSecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      sourceSecurityGroupId: serviceSg.securityGroupId,
    })

    const alb = new ApplicationLoadBalancer(this, 'Alb', { vpc: props.vpc, internetFacing: true, securityGroup: albSg })
    const certArn = process.env.ALB_CERT_ARN || this.node.tryGetContext('albCertArn')
    const httpListener = alb.addListener('Http', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: certArn ? ListenerAction.redirect({ protocol: 'HTTPS', port: '443' }) : undefined,
    })
    let listener = httpListener
    if (certArn) {
      albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(443))
      listener = alb.addListener('Https', {
        port: 443,
        protocol: ApplicationProtocol.HTTPS,
        certificates: [Certificate.fromCertificateArn(this, 'AlbCert', certArn)],
      })
    }
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
