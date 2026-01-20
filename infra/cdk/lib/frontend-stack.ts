import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { AllowedMethods, CachedMethods, Distribution, OriginAccessIdentity, PriceClass } from 'aws-cdk-lib/aws-cloudfront'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins'

interface FrontendStackProps extends cdk.StackProps {
  domainName?: string
  certArn?: string
}

export class FrontendStack extends cdk.Stack {
  public readonly bucket: Bucket
  public readonly distribution: Distribution

  constructor(scope: Construct, id: string, props?: FrontendStackProps) {
    super(scope, id, props)

    this.bucket = new Bucket(this, 'FrontendBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const oai = new OriginAccessIdentity(this, 'FrontendOai')
    this.bucket.grantRead(oai)

    const certArn = props?.certArn || process.env.FRONTEND_CERT_ARN || this.node.tryGetContext('frontendCertArn')
    const domainValue = props?.domainName || process.env.FRONTEND_DOMAIN || this.node.tryGetContext('frontendDomain')
    const domainNames = domainValue
      ? String(domainValue)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined

    this.distribution = new Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: PriceClass.PRICE_CLASS_100,
      certificate: certArn ? Certificate.fromCertificateArn(this, 'FrontendCert', certArn) : undefined,
      domainNames,
    })

    new cdk.CfnOutput(this, 'FrontendBucketName', { value: this.bucket.bucketName })
    new cdk.CfnOutput(this, 'FrontendDistributionId', { value: this.distribution.distributionId })
    new cdk.CfnOutput(this, 'FrontendDomainName', { value: this.distribution.distributionDomainName })
  }
}
