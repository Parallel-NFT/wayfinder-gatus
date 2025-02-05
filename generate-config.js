const fs = require("fs");
const yaml = require("yaml-boost");

// Wallet addresses
const EVM_ADDRESS_1 = "0x676f9336e1F43214333619fE3a25d87C5026c8bf";
const EVM_ADDRESS_2 = "0x8Ab2ec87870FCde4B11E4a67423107A723626671";
const SVM_ADDRESS_1 = "FziT2V4zLB3g6e1wTfMrurEQHSJ5QiXeg4FLrCyoN7hj";
const SVM_ADDRESS_2 = "41tRiWwMsmdfxkLuqHne8ELVu8i1aub4VPyFXonz2naC";

// Load configurations
const tokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
const chainsData = JSON.parse(fs.readFileSync("chains.json", "utf8"));

// Convert chains object to arrays for compatibility
const evmChains = Object.entries(chainsData.evm).map(([name, data]) => ({
  name,
  ...data,
}));

const svmChains = Object.entries(chainsData.svm).map(([name, data]) => ({
  name,
  ...data,
}));

const solanaLifi = svmChains.find((chain) => chain.name === "Solana_LiFi");
const solanaDeBridge = svmChains.find(
  (chain) => chain.name === "Solana_DeBridge"
);

const buildUrl = (baseUrl, params) => {
  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return `${baseUrl}?${queryString}`;
};

const native_minimums = {
  8453: { amount: "5000000000000000", symbol: "ETH", readable: "0.005" }, // 0.005 ETH ~20$
  42161: { amount: "5000000000000000", symbol: "ETH", readable: "0.005" }, // 0.005 ETH ~20$
  1: { amount: "10000000000000000", symbol: "ETH", readable: "0.01" }, // 0.01 ETH ~40$
  56: { amount: "30000000000000000", symbol: "BNB", readable: "0.03" }, // 0.03 BNB ~20$
  137: { amount: "30000000000000000000", symbol: "POL", readable: "30" }, // 30 POL ~20$
  1151111081099710: { amount: "100000000", symbol: "SOL", readable: "0.1" }, // 0.1 SOL ~20$
  7565164: { amount: "100000000", symbol: "SOL", readable: "0.1" }, // 0.1 SOL ~20$
};

// Configuration for different check types
const config = {
  intervals: {
    lifi_bridge: "3h",
    lifi_swap: "3h",
    http: "10s",
    debridge: "30m",
    odos_swap: "15m",
    zapper: "15m",
  },
  responseTimes: {
    // in ms
    lifi_bridge: 10000,
    lifi_swap: 10000,
    http: 2000,
    debridge: 10000,
    odos_swap: 10000,
    zapper: 5000,
  },
  lifi_swap: {
    amount: "5",
    amountWei: "5000000", // 5 USDC with 6 decimals
  },
  odos_swap: {
    amount: "5",
    amountWei: "5000000", // 5 USDC with 6 decimals
    slippageLimitPercent: 0.3,
  },
  http: {},
};

const generateLifiBridgeChecks = () => {
  return evmChains.map((fromChain, i) => {
    const toChain = evmChains[(i + 1) % evmChains.length];

    const { amount, symbol, readable } = native_minimums[fromChain.id];

    return {
      name: `[LiFi Bridge] (${readable} ${symbol} on ${fromChain.name}) -> (native on ${toChain.name})`,
      group: "lifi_bridge",
      url: buildUrl("https://li.quest/v1/quote", {
        fromChain: fromChain.id,
        toChain: toChain.id,
        fromToken: "0x0000000000000000000000000000000000000000",
        toToken: "0x0000000000000000000000000000000000000000",
        fromAmount: amount,
        fromAddress: EVM_ADDRESS_1,
        toAddress: EVM_ADDRESS_1,
        integrator: "wayfinder",
        denyExchanges: "1inch",
      }),
      interval: config.intervals.lifi_bridge,
      conditions: [
        "[STATUS] == any(200)",
        "[BODY] == pat(*transactionRequest*)",
        `[RESPONSE_TIME] < ${config.responseTimes.lifi_bridge}`,
      ],
    };
  });
};

const generateLifiSwapChecks = () => {
  const checks = [];

  // Original EVM chain swaps
  checks.push(
    ...evmChains.map((fromChain, i) => {
      const toChain = evmChains[(i + 1) % evmChains.length];
      const params = {
        fromChain: fromChain.id,
        toChain: toChain.id,
        fromToken: tokens.usdc[fromChain.id],
        toToken: tokens.usdc[toChain.id],
        fromAmount: config.lifi_swap.amountWei,
        fromAddress: EVM_ADDRESS_2,
        toAddress: EVM_ADDRESS_2,
        integrator: "wayfinder",
      };

      return {
        name: `[LiFi Swap] (${config.lifi_swap.amount} USDC on ${fromChain.name}) -> (USDC on ${toChain.name})`,
        group: "lifi_swap",
        url: buildUrl("https://li.quest/v1/quote", params),
        interval: config.intervals.lifi_swap,
        conditions: [
          "[STATUS] == any(200)",
          "[BODY] == pat(*transactionRequest*)",
          `[RESPONSE_TIME] < ${config.responseTimes.lifi_swap}`,
        ],
      };
    })
  );

  // Add Solana-specific LiFi swaps
  checks.push({
    name: "[LiFi Swap] (0.1 SOL on Solana) -> (USDC on Solana)",
    group: "lifi_swap",
    url: buildUrl("https://li.quest/v1/quote", {
      fromChain: solanaLifi.id,
      toChain: solanaLifi.id,
      fromToken: tokens.solana_tokens.native,
      toToken: tokens.solana_tokens.usdc,
      fromAmount: "100000000", // 0.1 SOL
      fromAddress: SVM_ADDRESS_1,
      toAddress: SVM_ADDRESS_1,
      integrator: "wayfinder",
      slippage: "0.005",
    }),
    interval: config.intervals.lifi_swap,
    conditions: [
      "[STATUS] == any(200)",
      "[BODY] == pat(*transactionRequest*)",
      `[RESPONSE_TIME] < ${config.responseTimes.lifi_swap}`,
    ],
  });

  return checks;
};

const generateHttpChecks = () => {
  return [
    {
      name: "Wayfinder Login",
      group: "api-health",
      url: "https://app.wayfinder.ai",
      conditions: [
        `[STATUS] == ${200}`,
        `[RESPONSE_TIME] < ${config.responseTimes.http}`,
      ],
      alerts: [
        {
          type: "slack",
          "failure-threshold": 6,
          description: "Wayfinder NextJS is down",
          "send-on-resolved": true,
        },
      ],
      interval: config.intervals.http,
    },
    {
      name: "Wayfinder Django",
      group: "api-health",
      url: "https://app.wayfinder.ai/api/v1/chat_ai_proxy/abi/?contract_address=0xef4fb24ad0916217251f553c0596f8edc630eb66&chain_name=base",
      conditions: [
        `[STATUS] == ${200}`,
        `[RESPONSE_TIME] < ${config.responseTimes.http}`,
      ],
      alerts: [
        {
          type: "slack",
          "failure-threshold": 6,
          description: "Wayfinder Django is down",
          "send-on-resolved": true,
        },
      ],
      interval: config.intervals.http,
    },
  ];
};

const generateOdosSwapChecks = () => {
  return evmChains.map((chain) => {
    return {
      name: `[Odos Swap] (${config.odos_swap.amount} USDC on ${chain.name}) -> (WETH on ${chain.name})`,
      group: "odos_swap",
      url: "https://api.odos.xyz/sor/quote/v2",
      method: "POST",
      body: JSON.stringify({
        chainId: parseInt(chain.id),
        compact: true,
        inputTokens: [
          {
            tokenAddress: tokens.usdc[chain.id],
            amount: config.odos_swap.amountWei,
          },
        ],
        outputTokens: [
          {
            tokenAddress: tokens.weth[chain.id],
            proportion: 1,
          },
        ],
        userAddr: EVM_ADDRESS_2,
        slippageLimitPercent: config.odos_swap.slippageLimitPercent,
        sourceBlacklist: [],
        sourceWhitelist: [],
      }),
      interval: config.intervals.odos_swap,
      conditions: [
        "[STATUS] == 200",
        "[BODY] == pat(*pathId*)",
        `[RESPONSE_TIME] < ${config.responseTimes.odos_swap}`,
      ],
    };
  });
};

const generateDebridgeChecks = () => {
  const checks = [];

  // Generate EVM chain to EVM chain checks
  evmChains.forEach((fromChain, i) => {
    const toChain = evmChains[(i + 1) % evmChains.length];

    const { amount, symbol, readable } = native_minimums[fromChain.id];

    checks.push({
      name: `[DeBridge] (${readable} ${symbol} on ${fromChain.name}) -> (native on ${toChain.name})`,
      group: "debridge",
      url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
        srcChainId: fromChain.id,
        srcChainTokenIn: "0x0000000000000000000000000000000000000000",
        srcChainTokenInAmount: amount,
        dstChainId: toChain.id,
        dstChainTokenOut: "0x0000000000000000000000000000000000000000",
        dstChainTokenOutAmount: "auto",
        dstChainTokenOutRecipient: EVM_ADDRESS_2,
        srcChainOrderAuthorityAddress: EVM_ADDRESS_1,
        dstChainOrderAuthorityAddress: EVM_ADDRESS_2,
        prependOperatingExpenses: "false",
      }),
      interval: config.intervals.debridge,
      conditions: [
        "[STATUS] == any(200)",
        "[BODY] == pat(*tx*)",
        `[RESPONSE_TIME] < ${config.responseTimes.debridge}`,
      ],
    });

    // Generate ETH to SOL native checks
    checks.push({
      name: `[DeBridge] (${readable} ${symbol} on ${fromChain.name}) -> (SOL on Solana)`,
      group: "debridge",
      url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
        srcChainId: fromChain.id,
        srcChainTokenIn: "0x0000000000000000000000000000000000000000",
        srcChainTokenInAmount: amount,
        dstChainId: solanaDeBridge.id,
        dstChainTokenOut: tokens.solana_tokens.native,
        dstChainTokenOutAmount: "auto",
        dstChainTokenOutRecipient: SVM_ADDRESS_1,
        srcChainOrderAuthorityAddress: EVM_ADDRESS_1,
        dstChainOrderAuthorityAddress: SVM_ADDRESS_1,
      }),
      interval: config.intervals.debridge,
      conditions: [
        "[STATUS] == any(200)",
        "[BODY] == pat(*tx*)",
        `[RESPONSE_TIME] < ${config.responseTimes.debridge}`,
      ],
    });

    // Generate SOL to ETH native checks
    let amountSol = "100000000";
    let readableSol = "0.1";
    if (toChain.id == 1) {
      amountSol = "300000000";
      readableSol = "0.3";
    }
    checks.push({
      name: `[DeBridge] (${readableSol} SOL on Solana) -> (ETH on ${toChain.name})`,
      group: "debridge",
      url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
        srcChainId: solanaDeBridge.id,
        srcChainTokenIn: tokens.solana_tokens.native,
        srcChainTokenInAmount: amountSol,
        dstChainId: toChain.id,
        dstChainTokenOut: "0x0000000000000000000000000000000000000000",
        dstChainTokenOutAmount: "auto",
        dstChainTokenOutRecipient: EVM_ADDRESS_2,
        srcChainOrderAuthorityAddress: SVM_ADDRESS_1,
        dstChainOrderAuthorityAddress: EVM_ADDRESS_2,
      }),
      interval: config.intervals.debridge,
      conditions: [
        "[STATUS] == any(200)",
        "[BODY] == pat(*tx*)",
        `[RESPONSE_TIME] < ${config.responseTimes.debridge}`,
      ],
    });
  });

  // Generate ETH to SOL SPL checks
  checks.push({
    name: `[DeBridge] (0.01 ETH on Ethereum) -> (Elephant on Solana)`,
    group: "debridge",
    url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
      srcChainId: "1",
      srcChainTokenIn: "0x0000000000000000000000000000000000000000",
      srcChainTokenInAmount: "10000000000000000",
      dstChainId: "7565164",
      dstChainTokenOut: tokens.solana_tokens.elephant,
      dstChainTokenOutAmount: "auto",
      dstChainTokenOutRecipient: SVM_ADDRESS_1,
      srcChainOrderAuthorityAddress: EVM_ADDRESS_1,
      dstChainOrderAuthorityAddress: SVM_ADDRESS_1,
    }),
    interval: config.intervals.debridge,
    conditions: [
      "[STATUS] == any(200)",
      "[BODY] == pat(*tx*)",
      `[RESPONSE_TIME] < ${config.responseTimes.debridge}`,
    ],
  });

  return checks;
};

const generateZapperChecks = () => {
  const checks = [];

  checks.push({
    name: `[Zapper] Refetch Token Balances for 0x8Ab2ec87870FCde4B11E4a67423107A723626671`,
    group: "zapper",
    method: "POST",
    headers: {
      Authorization:
        "Basic MTRlZGM5OTMtOGRlYy00MzQxLWEzNjItOTljMDBlZmYxOTBiOg==",
    },
    url: "https://api.zapper.xyz/v2/balances/tokens?addresses%5B%5D=0x8Ab2ec87870FCde4B11E4a67423107A723626671",
    interval: config.intervals.zapper,
    conditions: [
      "[STATUS] == any(201)",
      "[BODY] == pat(*jobId*)",
      `[RESPONSE_TIME] < ${config.responseTimes.zapper}`,
    ],
  });
  checks.push({
    name: `[Zapper] Refetch App Balances for 0x8Ab2ec87870FCde4B11E4a67423107A723626671`,
    group: "zapper",
    method: "POST",
    headers: {
      Authorization:
        "Basic MTRlZGM5OTMtOGRlYy00MzQxLWEzNjItOTljMDBlZmYxOTBiOg==",
    },
    url: "https://api.zapper.xyz/v2/balances/apps?addresses%5B%5D=0x8Ab2ec87870FCde4B11E4a67423107A723626671",
    interval: config.intervals.zapper,
    conditions: [
      "[STATUS] == any(201)",
      "[BODY] == pat(*jobId*)",
      `[RESPONSE_TIME] < ${config.responseTimes.zapper}`,
    ],
  });
  return checks;
};

// Generate configuration object
const configuration = {
  ui: {
    title: "WF Status",
    header: "Wayfinder Blame Dashboard",
    description: "Days since last incident: 398",
    logo: "https://pbs.twimg.com/profile_images/1768421252450934784/eEJYGxvM_400x400.jpg",
  },
  alerting: {
    slack: {
      "webhook-url":
        "https://hooks.slack.com/services/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",
    },
  },
  endpoints: [
    ...generateLifiBridgeChecks(),
    ...generateLifiSwapChecks(),
    ...generateHttpChecks(),
    ...generateDebridgeChecks(),
    ...generateOdosSwapChecks(),
    ...generateZapperChecks(),
  ],
};

// Write YAML file with proper formatting
fs.writeFileSync("config.yaml", yaml.dump(configuration, { indent: 2 }));

console.log("Configuration generated successfully!");
