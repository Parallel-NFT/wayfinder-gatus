const fs = require("fs");
const yaml = require("yaml-boost");

// Wallet addresses
const EVM_ADDRESS_1 = "0x676f9336e1F43214333619fE3a25d87C5026c8bf";
const EVM_ADDRESS_2 = "0x8Ab2ec87870FCde4B11E4a67423107A723626671";
const SOLANA_ADDRESS_1 = "FziT2V4zLB3g6e1wTfMrurEQHSJ5QiXeg4FLrCyoN7hj";
const SOLANA_ADDRESS_2 = "41tRiWwMsmdfxkLuqHne8ELVu8i1aub4VPyFXonz2naC";

// Load configurations
const tokens = JSON.parse(fs.readFileSync("tokens.json", "utf8"));
const chainsData = JSON.parse(fs.readFileSync("chains.json", "utf8"));

// Convert chains object to arrays for compatibility
const evmChains = Object.entries(chainsData.evm).map(([name, data]) => ({
  name,
  type: "EVM",
  ...data,
}));

const svmChains = Object.entries(chainsData.svm).map(([name, data]) => ({
  name,
  type: "SVM",
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

// Configuration for different check types
const config = {
  intervals: {
    lifi_bridge: "3h",
    lifi_swap: "3h",
    http: "15m",
    debridge: "30m",
    odos_swap: "30m",
  },
  responseTimes: {
    // in ms
    lifi_bridge: 7500,
    lifi_swap: 7500,
    http: 1000,
    debridge: 7500,
    odos_swap: 7500,
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
  lifi_bridge: {
    amount: "0.1",
    amountWei: "10000000000000000",
  },
  debridge: {
    amount: "0.01",
    amountWei: "10000000000000000",
  },
  http: {
    endpoints: [
      {
        name: "Wayfinder Login",
        group: "api-health",
        url: "https://dev.wayfinder.ai",
        expectedStatus: 200,
      },
    ],
  },
};

const generateLifiBridgeChecks = () => {
  return evmChains.map((fromChain, i) => {
    const toChain = evmChains[(i + 1) % evmChains.length];
    const params = {
      fromChain: fromChain.id,
      toChain: toChain.id,
      fromToken: "0x0000000000000000000000000000000000000000",
      toToken: "0x0000000000000000000000000000000000000000",
      fromAmount: config.lifi_bridge.amountWei,
      fromAddress: EVM_ADDRESS_2,
      toAddress: EVM_ADDRESS_2,
      integrator: "wayfinder",
      denyExchanges: "1inch",
    };

    return {
      name: `[LiFi Bridge] (${config.lifi_bridge.amount} native on ${fromChain.name}) -> (native on ${toChain.name})`,
      group: "lifi_bridge",
      url: buildUrl("https://li.quest/v1/quote", params),
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
      fromAddress: SOLANA_ADDRESS_1,
      toAddress: SOLANA_ADDRESS_1,
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
  return config.http.endpoints.map((endpoint) => ({
    name: endpoint.name,
    group: endpoint.group,
    url: endpoint.url,
    interval: config.intervals.http,
    conditions: [
      `[STATUS] == ${endpoint.expectedStatus}`,
      `[RESPONSE_TIME] < ${config.responseTimes.http}`,
    ],
  }));
};

const generateOdosSwapChecks = () => {
  return evmChains.map((chain) => {
    const body = {
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
    };

    return {
      name: `[Odos Swap] (${config.odos_swap.amount} USDC on ${chain.name}) -> (WETH on ${chain.name})`,
      group: "odos_swap",
      url: "https://api.odos.xyz/sor/quote/v2",
      method: "POST",
      body: JSON.stringify(body),
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
    const params = {
      srcChainId: fromChain.id,
      srcChainTokenIn: "0x0000000000000000000000000000000000000000",
      srcChainTokenInAmount: config.debridge.amountWei,
      dstChainId: toChain.id,
      dstChainTokenOut: "0x0000000000000000000000000000000000000000",
      dstChainTokenOutAmount: "auto",
      dstChainTokenOutRecipient: EVM_ADDRESS_2,
      srcChainOrderAuthorityAddress: EVM_ADDRESS_1,
      dstChainOrderAuthorityAddress: EVM_ADDRESS_2,
    };

    checks.push({
      name: `[DeBridge] (${config.debridge.amount} native on ${fromChain.name}) -> (native on ${toChain.name})`,
      group: "debridge",
      url: buildUrl(
        "https://dln.debridge.finance/v1.0/dln/order/create-tx",
        params
      ),
      interval: config.intervals.debridge,
      conditions: [
        "[STATUS] == any(200)",
        "[BODY] == pat(*tx*)",
        `[RESPONSE_TIME] < ${config.responseTimes.debridge}`,
      ],
    });

    // Generate ETH to SOL native checks
    checks.push({
      name: `[DeBridge] (${config.debridge.amount} native on ${fromChain.name}) -> (SOL on Solana)`,
      group: "debridge",
      url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
        srcChainId: fromChain.id,
        srcChainTokenIn: "0x0000000000000000000000000000000000000000",
        srcChainTokenInAmount: config.debridge.amountWei,
        dstChainId: solanaDeBridge.id,
        dstChainTokenOut: tokens.solana_tokens.native,
        dstChainTokenOutAmount: "auto",
        dstChainTokenOutRecipient: SOLANA_ADDRESS_1,
        srcChainOrderAuthorityAddress: EVM_ADDRESS_1,
        dstChainOrderAuthorityAddress: SOLANA_ADDRESS_1,
      }),
      interval: config.intervals.debridge,
      conditions: [
        "[STATUS] == any(200)",
        "[BODY] == pat(*tx*)",
        `[RESPONSE_TIME] < ${config.responseTimes.debridge}`,
      ],
    });

    // Generate SOL to ETH native checks
    checks.push({
      name: `[DeBridge] (0.2 SOL on Solana) -> (ETH on ${fromChain.name})`,
      group: "debridge",
      url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
        srcChainId: solanaDeBridge.id,
        srcChainTokenIn: tokens.solana_tokens.native,
        srcChainTokenInAmount: "200000000", // 0.2 SOL
        dstChainId: fromChain.id,
        dstChainTokenOut: "0x0000000000000000000000000000000000000000",
        dstChainTokenOutAmount: "auto",
        dstChainTokenOutRecipient: EVM_ADDRESS_2,
        srcChainOrderAuthorityAddress: SOLANA_ADDRESS_1,
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
    name: `[DeBridge] (${config.debridge.amount} ETH on Ethereum) -> (Elephant on Solana)`,
    group: "debridge",
    url: buildUrl("https://dln.debridge.finance/v1.0/dln/order/create-tx", {
      srcChainId: "1",
      srcChainTokenIn: "0x0000000000000000000000000000000000000000",
      srcChainTokenInAmount: config.debridge.amountWei,
      dstChainId: "7565164",
      dstChainTokenOut: tokens.solana_tokens.elephant,
      dstChainTokenOutAmount: "auto",
      dstChainTokenOutRecipient: SOLANA_ADDRESS_1,
      srcChainOrderAuthorityAddress: EVM_ADDRESS_1,
      dstChainOrderAuthorityAddress: SOLANA_ADDRESS_1,
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

// Generate configuration object
const configuration = {
  ui: {
    header: "Wayfinder Blame Dashboard",
    description: "Days since last incident: 398",
    logo: "https://pbs.twimg.com/profile_images/1768421252450934784/eEJYGxvM_400x400.jpg",
  },
  endpoints: [
    ...generateLifiBridgeChecks(),
    ...generateLifiSwapChecks(),
    ...generateHttpChecks(),
    ...generateDebridgeChecks(),
    ...generateOdosSwapChecks(),
  ],
};

// Write YAML file with proper formatting
fs.writeFileSync("config.yaml", yaml.dump(configuration, { indent: 2 }));

console.log("Configuration generated successfully!");
