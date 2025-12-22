export ACCOUNT_ID=112543432453
export AWS_REGION=eu-central-1

AWS_REGION=eu-central-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE="${ECR}/property-expenses-api:latest"

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR
docker build -t $IMAGE .
docker push $IMAGE

