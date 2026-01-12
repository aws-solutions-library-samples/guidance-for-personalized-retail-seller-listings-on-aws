/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

export class StorageStack extends cdk.Stack {
  // Expose resources for other stacks to use
  public readonly rawFilesBucket: s3.Bucket;
  public readonly accessLogsBucket: s3.Bucket;
  public readonly structuredDataBucket: s3.Bucket;
  public readonly jobTrackingTable: dynamodb.Table;
  public readonly lambdaExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an S3 bucket for access logs with ACLs enabled for S3 server access logging
    this.accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `pdg-access-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER, // Enable ACLs for S3 server access logs
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // S3 Buckets for file storage
    // 1. Raw Files Bucket - for uploaded PDFs and images
    this.rawFilesBucket = new s3.Bucket(this, 'RawFilesBucket', {
      bucketName: `pdg-raw-files-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: 'raw-files-bucket-logs/',
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedOrigins: ['*'], // This will be restricted in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // 2. Structured Data Bucket - for processed JSON data
    this.structuredDataBucket = new s3.Bucket(this, 'StructuredDataBucket', {
      bucketName: `pdg-structured-data-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: 'structured-data-bucket-logs/',
      enforceSSL: true,
    });

    // DynamoDB Table for job tracking
    this.jobTrackingTable = new dynamodb.Table(this, 'JobTrackingTable', {
      tableName: 'ProductDescriptionGeneratorJobs',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, // Updated from deprecated pointInTimeRecovery
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for userId to allow querying by user
    this.jobTrackingTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for status to allow querying by status
    this.jobTrackingTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Suppress CDK Nag warnings for access logs bucket
    NagSuppressions.addResourceSuppressions(
      this.accessLogsBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'This is the access logs bucket itself, so it does not need its own access logs',
        },
      ],
      true
    );
    
    

    // Output the resource ARNs for reference
    new cdk.CfnOutput(this, 'RawFilesBucketArn', {
      value: this.rawFilesBucket.bucketArn,
      description: 'ARN of the raw files S3 bucket',
    });

    new cdk.CfnOutput(this, 'StructuredDataBucketArn', {
      value: this.structuredDataBucket.bucketArn,
      description: 'ARN of the structured data S3 bucket',
    });

    new cdk.CfnOutput(this, 'JobTrackingTableArn', {
      value: this.jobTrackingTable.tableArn,
      description: 'ARN of the job tracking DynamoDB table',
    });

  }
}
