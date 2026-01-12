/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';

export class EventBusStack extends cdk.Stack {
  public readonly bdaEventBus: events.EventBus;
  
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create custom event bus for BDA events
    this.bdaEventBus = new events.EventBus(this, 'BDAEventBus', {
      eventBusName: 'product-description-generator-bda-events'
    });
    
    // Output the BDA Event Bus ARN
    new cdk.CfnOutput(this, 'BDAEventBusArn', {
      value: this.bdaEventBus.eventBusArn,
      description: 'ARN of the BDA Event Bus',
    });
  }
}
