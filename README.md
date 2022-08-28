# Minecraft Terraform CDK

Simple Minecraft server stack, CDK for Terraform edition.

## Usage

Install CDK for Terraform following https://learn.hashicorp.com/tutorials/terraform/cdktf-install?in=terraform/cdktf

```
terraform login
cdktf deploy

cd cdktf.out/stacks/minecraft-cdktf
(umask 0077; terraform output -raw privateKey > key.pem)
ssh -i key.pem ec2-user@$(terraform output -raw publicIp)
```
