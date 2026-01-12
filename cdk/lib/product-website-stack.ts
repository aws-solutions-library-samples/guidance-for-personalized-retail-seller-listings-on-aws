/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { RemovalPolicy } from 'aws-cdk-lib';
import { WebAcl } from './waf';
import * as deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { WafwebaclToCloudFront } from '@aws-solutions-constructs/aws-wafwebacl-cloudfront';
import { NagSuppressions } from 'cdk-nag';

export interface ProductWebsiteStackProps extends cdk.StackProps {
  structuredDataBucket: s3.IBucket;
  userPool?: cognito.IUserPool;
  api: apigateway.RestApi;
}

export class ProductWebsiteStack extends cdk.Stack {
  public readonly websiteAssetsBucket: s3.IBucket;
  public readonly cloudFrontDistribution: cloudfront.Distribution;
  
  constructor(scope: Construct, id: string, props: ProductWebsiteStackProps) {
    super(scope, id, props);

    const logsBucket = new s3.Bucket(this, 'LogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // const cloudfrontWebAcl = new WebAcl(this, "CloudfrontWebsiteACL", {
    //   name: `${cdk.Stack.of(this).stackName}-${this.region}-CloudfrontACL`,
    //   managedRules: [
    //     { VendorName: "AWS", Name: "AWSManagedRulesCommonRuleSet" },
    //   ],
    //   scope: "CLOUDFRONT",
    //   region: "us-east-1", // must be in us-east-1; no cdk bootstrapping required in us-east-1
    // });

    // Website Assets Bucket - for generated websites
    this.websiteAssetsBucket = new s3.Bucket(this, 'WebsiteAssetsBucket', {
      bucketName: `pdg-websites-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Will be updated later for website hosting
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: 'website-assets-bucket-logs/',
      enforceSSL: true,
    });
    
    this.cloudFrontDistribution = new cloudfront.Distribution(this, 'Distribution', {
      // webAclId: cloudfrontWebAcl.webAclArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.websiteAssetsBucket, {
          originAccessControl: new cloudfront.S3OriginAccessControl(this, 'WebsiteOriginAccessControl', {
            signing: cloudfront.Signing.SIGV4_NO_OVERRIDE
          })
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      geoRestriction: cloudfront.GeoRestriction.allowlist('US', 'GB', 'CA'),
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html"
        }
      ],
      defaultRootObject: "index.html",
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: "cloudfront",
    });


    // /**
    //  * Bucket Deployment
    //  */
    // new deploy.BucketDeployment(this, 'WebsiteDeployment', {
    //   sources: [deploy.Source.asset(path.join(__dirname, "..", "..", "..", "website", "build"))],
    //   destinationBucket: this.websiteAssetsBucket,
    //   distribution: this.cloudFrontDistribution,
    //   serverSideEncryption: deploy.ServerSideEncryption.AES_256,
    //   extract: true,
    //   exclude: ['*.DS_Store'],
    // });

    // Suppress CDK Nag warnings for CloudFront distribution
    NagSuppressions.addResourceSuppressions(
      this.cloudFrontDistribution,
      [
        {
          id: 'AwsSolutions-CFR2',
          reason: 'AWS WAF will be implemented in a later phase as this is a development environment',
        },
        {
          id: 'AwsSolutions-CFR1',
          reason: 'Geo restrictions will be implemented in a later phase as this is a development environment',
        },
        {
          id: 'AwsSolutions-CFR4',
          reason: 'TLS 1.2 is set as the minimum protocol version, which is compliant with security best practices',
        },
      ],
      true
    );
    

    NagSuppressions.addResourceSuppressions(this.cloudFrontDistribution, [
      {
        id: "AwsSolutions-CFR4",
        reason: "CloudFront default certificate used for prototype."
      }
    ]);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason: "CDK BucketDeployment Construct adds the Amazon Managed IAM role, AWSLambdaBasicExecutionRole, to the deployment Lambda Function.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "BucketDeployment Function requires access to list buckets in account and region",
      },
      {
        id: "AwsSolutions-L1",
        reason: "CDK BucketDeployment Construct uses non-container Lambda runtime",
      },
    ], true);

    // Output the API Gateway URL (from the consolidated API)
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: props.api.url,
      description: 'URL of the consolidated API Gateway',
    });

    // Output the CloudFront distribution URL
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${this.cloudFrontDistribution.distributionDomainName}`,
      description: 'URL of the CloudFront distribution',
    });

    new cdk.CfnOutput(this, 'WebsiteAssetsBucketArn', {
      value: this.websiteAssetsBucket.bucketArn,
      description: 'ARN of the website assets S3 bucket',
    });
  }
}
