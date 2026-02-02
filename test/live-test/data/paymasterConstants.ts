import { Hex, toHex, pad, Address, concat, size } from "viem";

export const PaymasterData = {
    // Sponsored ERC20
    ERC20_ADDRESS: '0x000e4C20CCC59A2221A5B2E41aD56F4F22eF2202' as Address,

    // Exchange Rate
    EXCHANGE_RATE: BigInt(3000e18),

    // Treasury
    TREASURY: '0xA84E4F9D72cb37A8276090D3FC50895BD8E5Aaf1' as Address,

    // Suffix for async feature in the paymaster Data
    PAYMASTER_SIG_MAGIC: '0x22e325a297439656' as Hex,

    // Dummy signature for paymaster data in estimation phase
    DUMMY_PAYMASTER_SIGNATURE: '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex,

    // Signature length for async paymaster feature
    SIGNATURE_LENGTHS: pad(toHex(65), { size: 2 }) as Hex,

    // Paymaster address with async feature
    PAYMASTER_ADDRESS_V9_ASYNC: "0xDeAD9fee9D14BDe85D4A52e9D2a85E366d607a97" as Address,

    // Paymaster mode 0 (Native token sponsoring)
    VERIFYING_MODE: 0n,

    // Bundler Allowance (1 = allow all bundlers EOAs)
    MODE: (() => {
        const MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH = 1n;
        const BUILD_MODE = (0n << 1n) | MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH;
        return pad(toHex(BUILD_MODE), { size: 1 });
    })(),

    MODE_ERC20: (() => {
        const MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH = 1n;
        const BUILD_MODE = (1n << 1n) | MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH;
        return pad(toHex(BUILD_MODE), { size: 1 });
    })(),

    // ERC20 Modes (combinedByte bit flags)
    // Bit 0 (0x01): constantFeePresent - adds 16 bytes for constant fee
    // Bit 1 (0x02): recipientPresent - adds 20 bytes for recipient
    // Bit 2 (0x04): preFundPresent - adds 16 bytes for preFund

    // Basic ERC20 mode - no optional fields (0b000)
    COMBINED_BYTE_BASIC: '0x00' as Hex,

    // ERC20 mode with constant fee (0b001)
    COMBINED_BYTE_CONSTANT_FEE: '0x01' as Hex,

    // ERC20 mode with recipient (0b010)
    COMBINED_BYTE_RECIPIENT: '0x02' as Hex,

    // ERC20 mode with constant fee + recipient (0b011)
    COMBINED_BYTE_CONSTANT_FEE_RECIPIENT: '0x03' as Hex,

    // ERC20 mode with preFund (0b100)
    COMBINED_BYTE_PREFUND: '0x04' as Hex,

    // ERC20 mode with preFund + constant fee (0b101)
    COMBINED_BYTE_PREFUND_CONSTANT_FEE: '0x05' as Hex,

    // ERC20 mode with preFund + recipient (0b110)
    COMBINED_BYTE_PREFUND_RECIPIENT: '0x06' as Hex,

    // ERC20 mode with all optional fields (0b111)
    COMBINED_BYTE_ALL: '0x07' as Hex,

    // Constant fee in token units
    CONSTANT_FEE: 10000000000000000000n, // 10 USDC

    // Recipient address - receives excess tokens when preFund > actualCost
    // Used with COMBINED_BYTE_RECIPIENT (0x02) or combinations
    RECIPIENT: '0xA84E4F9D72cb37A8276090D3FC50895BD8E5Aaf1' as Address,

    // PreFund amount in token units - amount charged upfront before execution
    // Used with COMBINED_BYTE_PREFUND (0x04) or combinations
    PREFUND_IN_TOKEN: 1000000n, // 1 USDC (6 decimals)

    // Paymaster data timestamp validity windows
    VALID_UNTIL: pad(toHex(1796977534), { size: 6 }),
    VALID_AFTER: pad(toHex(0), { size: 6 }),

    // Stub Gas
    // Base paymaster validation gas (no preFund transfer)
    PAYMASTER_VALIDATION_GAS_LIMIT: 100_000n,
    // Higher limit for preFund modes (includes safeTransferFrom during validation)
    PAYMASTER_VALIDATION_GAS_LIMIT_PREFUND: 200_000n,
    VERIFICATION_GAS_LIMIT: 400_000n,
    POST_GAS_LIMIT: 50_000n,
} as const;
