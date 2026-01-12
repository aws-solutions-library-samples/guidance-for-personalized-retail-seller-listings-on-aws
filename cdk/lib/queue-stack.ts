/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';

export class QueueStack extends cdk.Stack {
  public readonly processingQueue: sqs.Queue;
  
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create SQS queue for processing jobs
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: 'ProductDescriptionGeneratorDeadLetterQueue',
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true, // Fix for AwsSolutions-SQS4
    });

    this.processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: 'ProductDescriptionGeneratorProcessingQueue',
      visibilityTimeout: cdk.Duration.minutes(15), // Match Lambda function timeout (15 minutes)
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true, // Fix for AwsSolutions-SQS4
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Output the Processing Queue URL
    new cdk.CfnOutput(this, 'ProcessingQueueUrl', {
      value: this.processingQueue.queueUrl,
      description: 'URL of the Processing SQS Queue',
    });

    // Output the Processing Queue ARN
    new cdk.CfnOutput(this, 'ProcessingQueueArn', {
      value: this.processingQueue.queueArn,
      description: 'ARN of the Processing SQS Queue',
    });
  }
}
