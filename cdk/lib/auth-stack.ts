/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

export interface AuthStackProps extends cdk.StackProps {
  // No API Gateway dependency
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly authenticatedRole: iam.Role;
  public readonly unauthenticatedRole: iam.Role;

  constructor(scope: Construct, id: string, props?: AuthStackProps) {
    super(scope, id, props);

    // Create a Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'ProductDescriptionGeneratorUserPool', {
      userPoolName: 'ProductDescriptionGeneratorUserPool',
      selfSignUpEnabled: false, // Users will be managed by administrators
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a User Pool Client
    this.userPoolClient = this.userPool.addClient('ProductDescriptionGeneratorWebClient', {
      userPoolClientName: 'ProductDescriptionGeneratorWebClient',
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      preventUserExistenceErrors: true,
      generateSecret: false, // No secret needed for web clients
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      oAuth: {
        flows: {
          implicitCodeGrant: true,
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          'http://localhost:5173/', // Local development
          'https://localhost:5173/',
          'http://localhost:3000/',
          'https://localhost:3000/',
          // Add CloudFront URL when available
        ],
        logoutUrls: [
          'http://localhost:5173/', // Local development
          'https://localhost:5173/',
          'http://localhost:3000/',
          'https://localhost:3000/',
          // Add CloudFront URL when available
        ],
      },
    });

    // Create an Identity Pool
    this.identityPool = new cognito.CfnIdentityPool(this, 'ProductDescriptionGeneratorIdentityPool', {
      identityPoolName: 'ProductDescriptionGeneratorIdentityPool',
      allowUnauthenticatedIdentities: false, // Require authentication
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Create IAM roles for authenticated and unauthenticated users
    this.authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Role for authenticated users of the Product Description Generator',
    });

    this.unauthenticatedRole = new iam.Role(this, 'CognitoUnauthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Role for unauthenticated users of the Product Description Generator',
    });

    // Attach role mappings to the Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: this.authenticatedRole.roleArn,
        unauthenticated: this.unauthenticatedRole.roleArn,
      },
    });

    // Add permissions to the authenticated role
    this.authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
        ],
        resources: [
          'arn:aws:s3:::product-description-generator-raw-files-*',
          'arn:aws:s3:::product-description-generator-raw-files-*/*',
          'arn:aws:s3:::product-description-generator-structured-data-*',
          'arn:aws:s3:::product-description-generator-structured-data-*/*',
        ],
      })
    );

    // Add general permission to call API Gateway
    this.authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'execute-api:Invoke',
        ],
        resources: [
          'arn:aws:execute-api:*:*:*/*/*/*',
        ],
      })
    );

    // Add minimal permissions to the unauthenticated role
    this.unauthenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
        ],
        resources: [
          'arn:aws:s3:::product-description-generator-websites-*/*',
        ],
      })
    );

    // Suppress CDK Nag warnings for specific cases
    NagSuppressions.addResourceSuppressions(
      this.authenticatedRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The authenticated role needs access to specific S3 buckets and API Gateway endpoints',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this.unauthenticatedRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The unauthenticated role only needs read access to the website assets',
        },
      ],
      true
    );
    
    // Suppress MFA and Advanced Security warnings for development environment
    NagSuppressions.addResourceSuppressions(
      this.userPool,
      [
        {
          id: 'AwsSolutions-COG2',
          reason: 'MFA is not required for this development environment as it would complicate testing',
        },
        {
          id: 'AwsSolutions-COG3',
          reason: 'Advanced security mode is not required for this development environment',
        },
      ],
      true
    );

    // Output the Cognito User Pool ID and Client ID
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'ID of the Cognito User Pool',
      exportName: 'ProductDescriptionGeneratorUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'ID of the Cognito User Pool Client',
      exportName: 'ProductDescriptionGeneratorUserPoolClientId',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'ID of the Cognito Identity Pool',
      exportName: 'ProductDescriptionGeneratorIdentityPoolId',
    });
  }
}
