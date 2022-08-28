import { Construct } from "constructs";
import { App, TerraformStack, RemoteBackend, Fn, TerraformOutput, Token} from "cdktf";
import { DataAwsAvailabilityZones } from "@cdktf/provider-aws/lib/datasources";
import { Vpc } from "./.gen/modules/vpc";
import { AwsProvider } from "@cdktf/provider-aws";
import { SecurityGroup } from "@cdktf/provider-aws/lib/vpc";
import { PrivateKey, TlsProvider } from "@cdktf/provider-tls";
import { DataAwsAmi, Instance, KeyPair } from "@cdktf/provider-aws/lib/ec2";
import { RandomProvider, Shuffle } from "@cdktf/provider-random";
import * as path from 'path';

interface MinecraftCdkTfStackProps {
  readonly namespace: string
  readonly environment: string
  readonly region: string
  readonly maxAzs?: number
  readonly vpcCidr?: string
  readonly minecraftVersion?: string,
  readonly allowIngressFrom?: string[]
}

const minecraftDownloadUrls: { [version: string]: string } = {
  '1.19.2': "https://piston-data.mojang.com/v1/objects/f69c284232d7c7580bd89a5a4931c3581eae1378/server.jar"
}

class MinecraftCdkTfStack extends TerraformStack {
  constructor(scope: Construct, name: string, props: MinecraftCdkTfStackProps) {
    super(scope, name);

    const {
      namespace, 
      environment, 
      region,
      maxAzs = 3,
      minecraftVersion = '1.19.2',
      allowIngressFrom = ['0.0.0.0/0'],
      vpcCidr = '10.0.0.0/16',
    } = props;

    new AwsProvider(this, 'aws', {region});
    new TlsProvider(this, 'tls');
    new RandomProvider(this, 'random');

    const tags = {
      'app:namespace': namespace,
      'app:environment': environment,
      'cdktf:stack-name': name
    }

    const azs = new DataAwsAvailabilityZones(this, 'azs', {
      state: 'available'  
    });

    const numAzs = Fn.min([Fn.lengthOf(azs.names), maxAzs]);
    const useAzs = Fn.slice(azs.names, 0, numAzs);

    // Data sources are not evaluated at synth time, so we can't use `numAzs` to determine the range of subnets
    // Using `mazAzs`, which is known at synth time may end up generating more cidr blocks than we eventually need but that's not a problem
    // Note that `Fn.cidrsubnet` will effectively be translated into a verbatim call to `cidrsubnet()` with a hardcoded value for `i`
    // For example, `privateSubnets` will evaluate to [Fn.cidrsubnet("10.0.0.0/16", 8, 0), Fn.cidrsubnet("10.0.0.0/16", 8, 0), ...] 
    // See https://www.reddit.com/r/Terraform/comments/wmszfs/comment/ik2flq0/?utm_source=share&utm_medium=web2x&context=3
    const range = [...Array(maxAzs)];
    const privateSubnets = range.map((_, i) => Fn.cidrsubnet(vpcCidr, 8, i));
    const dbSubnets = range.map((_, i) => Fn.cidrsubnet(vpcCidr, 8, i+10));
    const publicSubnets = range.map((_, i) => Fn.cidrsubnet(vpcCidr, 8, i+20));

    const vpc = new Vpc(this, 'vpc', {
      name: `${namespace}-vpc`,
      cidr: vpcCidr,
      privateSubnets: Fn.slice(privateSubnets, 0, numAzs),
      databaseSubnets: Fn.slice(dbSubnets, 0, numAzs),
      publicSubnets: Fn.slice(publicSubnets, 0, numAzs),
      enableNatGateway: true,
      singleNatGateway: true,
      azs: useAzs,
      tags: tags
    });

    const sg = new SecurityGroup(this, 'minecraftSg', {
      vpcId: vpc.vpcIdOutput,
      tags,
      ingress: [
        {
          cidrBlocks: allowIngressFrom,
          description: 'SSH ingress',
          fromPort: 22,
          toPort: 22,
          protocol: 'tcp'
        },
        {
          cidrBlocks: allowIngressFrom,
          description: 'Minecraft server ingress',
          fromPort: 25565,
          toPort: 25565,
          protocol: 'tcp'
        }
      ],
      egress: [
        {
          cidrBlocks: ['0.0.0.0/0'],
          description: 'Internet egress',
          fromPort: 0,
          toPort: 0,
          protocol: '-1'
        }
      ]
    });

    const tlsKeypair = new PrivateKey(this, 'tlsKeyPair', {
      algorithm: 'RSA',
      rsaBits: 4096
    });

    const ec2Keypair = new KeyPair(this, 'keypair', {
      tags,
      keyNamePrefix: namespace,
      publicKey: tlsKeypair.publicKeyOpenssh
    });
    
    const ami = new DataAwsAmi(this, 'ami', {
      mostRecent: true,
      filter: [
        {
          name: 'owner-alias',
          values: ['amazon']
        },
        {
          name: 'name',
          values: ["amzn2-ami-hvm-*-x86_64-ebs"]
        }
      ]
    });

    const subnets = new Shuffle(this, 'shuffle', {
      input: Token.asList(vpc.publicSubnetsOutput)
    });

    const instance = new Instance(this, 'minecraftServer', {
      ami: ami.id,
      associatePublicIpAddress: true,
      subnetId: Fn.element(subnets.result, 0),
      userData: Fn.templatefile(path.join(__dirname, "init.sh"), {downloadUrl: minecraftDownloadUrls[minecraftVersion]}),
      keyName: ec2Keypair.keyName,
      instanceType: 't2.small',
      vpcSecurityGroupIds: [sg.id]
    });

    new TerraformOutput(this, 'publicIp', {
      value: instance.publicIp
    });

    new TerraformOutput(this, 'privateIp', {
      value: instance.privateIp
    });

    new TerraformOutput(this, 'instanceId', {
      value: instance.id
    });

    new TerraformOutput(this, 'privateKey', {
      value: tlsKeypair.privateKeyPem,
      sensitive: true
    });
  }
}

const app = new App();
const stack = new MinecraftCdkTfStack(app, "minecraft-cdktf", {
  environment: 'sandbox',
  namespace: 'minecraft-cdktf',
  region: 'ap-southeast-1'
});

new RemoteBackend(stack, {
  hostname: "app.terraform.io",
  organization: "joerx",
  workspaces: {
    name: "minecraft-cdktf"
  }
});

app.synth();
