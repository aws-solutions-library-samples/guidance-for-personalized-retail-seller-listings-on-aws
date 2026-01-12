/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import { Stack, Names, RemovalPolicy } from "aws-cdk-lib";
import {
    AwsCustomResource,
    AwsCustomResourcePolicy,
    PhysicalResourceId,
    PhysicalResourceIdReference,
} from "aws-cdk-lib/custom-resources";
import { WAFV2 } from "aws-sdk";
import { Construct } from "constructs";
import { WafwebaclToApiGateway } from '@aws-solutions-constructs/aws-wafwebacl-apigateway';
import { wrapManagedRuleSet } from '@aws-solutions-constructs/core';
import * as waf from "aws-cdk-lib/aws-wafv2";
import { RestApi } from 'aws-cdk-lib/aws-apigateway';


export interface WebAclProps {
    name: string;
    managedRules: WAFV2.ManagedRuleGroupStatement[];
    scope: "CLOUDFRONT" | "REGIONAL";
    region: string;
}

/**
 * This construct creates a WAFv2 Web ACL for Cloudfront or AppSync in the appropriate region.
 */
export class WebAcl extends Construct {
    public readonly webAclId: string;
    public readonly webAclArn: string;
    public readonly name: string;

    constructor(scope: Construct, id: string, props: WebAclProps) {
        super(scope, id);

        this.name = `${props.name}_${Names.uniqueId(this)}`;

        // The parameters for creating the Web ACL
        const createWebACLRequest: WAFV2.Types.CreateWebACLRequest = {
            Name: this.name,
            DefaultAction: { Allow: {} },
            Scope: props.scope,
            VisibilityConfig: {
                CloudWatchMetricsEnabled: true,
                MetricName: id,
                SampledRequestsEnabled: true,
            },
            Rules: props.managedRules.map((rule, Priority) => ({
                Name: `${rule.VendorName}-${rule.Name}`,
                Priority,
                Statement: { ManagedRuleGroupStatement: rule },
                OverrideAction: { None: {} },
                VisibilityConfig: {
                    MetricName: `${rule.VendorName}-${rule.Name}`,
                    CloudWatchMetricsEnabled: true,
                    SampledRequestsEnabled: true,
                },
            })),
        };

        // Create the Web ACL
        const createCustomResource = new AwsCustomResource(this, `Create${this.node.id}`, {
            policy: AwsCustomResourcePolicy.fromSdkCalls({
                resources: AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
            onCreate: {
                service: "WAFV2",
                action: "createWebACL",
                parameters: createWebACLRequest,
                region: props.region,
                physicalResourceId: PhysicalResourceId.fromResponse("Summary.Id"),
            },
        });
        this.webAclId = createCustomResource.getResponseField("Summary.Id");

        const getWebACLRequest: WAFV2.Types.GetWebACLRequest = {
            Name: this.name,
            Scope: props.scope,
            Id: this.webAclId,
        };

        // A second custom resource is used for managing the deletion of this construct, since both an Id and LockToken
        // are required for Web ACL Deletion
        new AwsCustomResource(this, `Delete${this.node.id}`, {
            policy: AwsCustomResourcePolicy.fromSdkCalls({
                resources: AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
            onCreate: {
                service: "WAFV2",
                action: "getWebACL",
                parameters: getWebACLRequest,
                region: props.region,
                physicalResourceId: PhysicalResourceId.fromResponse("LockToken"),
            },
            onDelete: {
                service: "WAFV2",
                action: "deleteWebACL",
                parameters: {
                    Name: this.name,
                    Scope: props.scope,
                    Id: this.webAclId,
                    LockToken: new PhysicalResourceIdReference(),
                },
                region: props.region,
            },
        });
        this.webAclArn = `arn:aws:wafv2:${props.region}:${Stack.of(this).account}:${props.scope === "CLOUDFRONT" ? "global" : "regional"
            }/webacl/${this.name}/${this.webAclId}`;
    }
}

export interface WafWebAclApiGatewayConstructProps {
    api: RestApi;
    allowPostman: boolean;
    removalPolicy: RemovalPolicy;
    autoDelete: boolean;
}

/**
 * Storage Resources
 */
export class WafWebAclApiGatewayConstruct extends Construct {
    readonly webAcl: waf.CfnWebACL;

    constructor(scope: Construct, id: string, props: WafWebAclApiGatewayConstructProps) {
        super(scope, id);

        // default aws managed rules for API Gateway
        const rules: Array<waf.CfnRuleGroup.RuleProperty> = [
            wrapManagedRuleSet("AWSManagedRulesKnownBadInputsRuleSet", "AWS", 2),
            wrapManagedRuleSet("AWSManagedRulesCommonRuleSet", "AWS", 3),
            wrapManagedRuleSet("AWSManagedRulesAnonymousIpList", "AWS", 4),
            wrapManagedRuleSet("AWSManagedRulesAmazonIpReputationList", "AWS", 5),
            wrapManagedRuleSet("AWSManagedRulesAdminProtectionRuleSet", "AWS", 6),
            wrapManagedRuleSet("AWSManagedRulesSQLiRuleSet", "AWS", 7),
        ];

        // custom waf rule to allow api testing from postman
        if (props.allowPostman) {
            const postmanAllowRule: waf.CfnRuleGroup.RuleProperty = {
                name: "CustomPostmanAllowRule",
                priority: 100,
                statement: {
                    andStatement: {
                        statements: [
                            {
                                labelMatchStatement: {
                                    scope: "LABEL",
                                    key: "awswaf:managed:aws:bot-control:signal:non_browser_user_agent"
                                }
                            },
                            {
                                notStatement: {
                                    statement: {
                                        byteMatchStatement: {
                                            fieldToMatch: {
                                                singleHeader: {
                                                    "Name": "user-agent"
                                                }
                                            },
                                            positionalConstraint: "CONTAINS",
                                            searchString: "PostmanRuntime",
                                            textTransformations: [
                                                {
                                                    priority: 0,
                                                    type: "NONE"
                                                }
                                            ]
                                        }
                                    }
                                }
                            }
                        ]
                    }
                },
                action: {
                    block: {}
                },
                ruleLabels: [],
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: "PostmanAllowRuleSet"
                }
            };

            // modify bot control rule set to work with custom postman rule
            const botControlRuleSet: waf.CfnWebACL.RuleProperty = {
                name: "AWSManagedRulesBotControlRuleSet",
                priority: 1,
                statement: {
                    managedRuleGroupStatement: {
                        name: "AWSManagedRulesBotControlRuleSet",
                        vendorName: "AWS",
                        managedRuleGroupConfigs: [{
                            awsManagedRulesBotControlRuleSet: {
                                inspectionLevel: "COMMON"
                            }
                        }],
                        ruleActionOverrides: [
                            {
                                name: "SignalNonBrowserUserAgent",
                                actionToUse: {
                                    count: {}
                                }
                            }
                        ]
                    }
                },
                overrideAction: {
                    none: {}
                },
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: "AWSManagedRulesBotControlRuleSet"
                }
            };

            rules.push(botControlRuleSet);
            rules.push(postmanAllowRule);
        } else {
            // add default bot control rule set
            rules.push(wrapManagedRuleSet("AWSManagedRulesBotControlRuleSet", "AWS", 1));
        }

        // WAF WebACL
        const apiGatewayWebAcl = new WafwebaclToApiGateway(this, "WAFWebACL", {
            existingApiGatewayInterface: props.api,
            webaclProps: {
                defaultAction: {
                    allow: {}
                },
                scope: "REGIONAL",
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    metricName: 'webACL',
                    sampledRequestsEnabled: true
                },
                rules: rules
            },
        });
        apiGatewayWebAcl.webacl.applyRemovalPolicy(props.removalPolicy);
        this.webAcl = apiGatewayWebAcl.webacl;
    }
}