# Load environment variables from .env
include .env
export $(shell sed 's/=.*//' .env)

.SILENT:

deploy-erc5564:
	forge script ./script/deploy/DeployERC5564.s.sol \
		--private-key $(PRIVATE_KEY_ANVIL) \
		--rpc-url $(RPC_URL_ANVIL) \
		-vv \
		--broadcast

deploy-6538:
	forge script ./script/deploy/DeployERC6538.s.sol \
		--private-key $(PRIVATE_KEY_ANVIL) \
		--rpc-url $(RPC_URL_ANVIL) \
		-vv \
		--broadcast

deploy-epv9:
	forge script ./script/deploy/DeployEPv9.s.sol \
		--private-key $(PRIVATE_KEY_ANVIL) \
		--rpc-url $(RPC_URL_ANVIL) \
		-vv \
		--broadcast

deploy-paymaster:
	forge script ./script/deploy/DeployPaymasterV3V9.s.sol \
		--private-key $(PRIVATE_KEY_ANVIL) \
		--rpc-url $(RPC_URL_ANVIL) \
		-vv \
		--broadcast

deploy-mock-erc20:
	forge script ./script/deploy/DeployMockERC20.s.sol \
		--private-key $(PRIVATE_KEY_ANVIL) \
		--rpc-url $(RPC_URL_ANVIL) \
		-vv \
		--broadcast

deploy-7702:
	forge script ./script/deploy/Deploy7702.s.sol \
		--private-key $(PRIVATE_KEY_ANVIL) \
		--rpc-url $(RPC_URL_ANVIL) \
		-vv \
		--broadcast
