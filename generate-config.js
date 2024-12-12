const fs = require("fs");
const yaml = require("yaml-boost");

// Configuration for different check types
const config = {
  global: {
    interval: "5m",
    responseTimes: {
      lifi_bridge: 500, // LiFi cross-chain swaps need more time
      lifi_swap: 500, // USDC same-chain swaps should be faster
      http: 50, // Basic HTTP checks should be very fast
    },
  },
  lifi_swap: {
    amount: "5",
    amountWei: "5000000", // 5 USDC with 6 decimals
    address: "0x8Ab2ec87870FCde4B11E4a67423107A723626671",
    polygon: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // Polygon USDC contract
  },
  lifi: {
    amount: "0.1",
    amountWei: "10000000000000000",
    address: "0x8Ab2ec87870FCde4B11E4a67423107A723626671",
    chains: [
      { name: "Base", id: "8453" },
      { name: "Mainnet", id: "1" },
      { name: "Arbitrum", id: "42161" },
      { name: "BNB", id: "56" },
      { name: "Polygon", id: "137" },
    ],
  },
  http: {
    endpoints: [
      {
        name: "Example API Health Check",
        group: "api-health",
        url: "https://api.example.com/health",
        expectedStatus: 200,
      },
    ],
  },
};

function generateLifiChecks() {
  return config.lifi.chains.flatMap((fromChain, i) =>
    config.lifi.chains.flatMap((toChain, j) =>
      i === j
        ? []
        : [
            {
              name: `${config.lifi.amount} native on ${fromChain.name} -> native on ${toChain.name}`,
              group: "lifi_bridge",
              url: `https://li.quest/v1/quote?fromChain=${fromChain.id}&toChain=${toChain.id}&fromToken=0x0000000000000000000000000000000000000000&toToken=0x0000000000000000000000000000000000000000&fromAmount=${config.lifi.amountWei}&fromAddress=${config.lifi.address}&toAddress=${config.lifi.address}&integrator=wayfinder&denyExchanges=1inch`,
              interval: config.global.interval,
              conditions: [
                "[STATUS] == 200",
                "[BODY].status == UP",
                `[RESPONSE_TIME] < ${config.global.responseTimes.lifi_bridge}`,
              ],
            },
          ]
    )
  );
}

function generateUsdcChecks() {
  // Generate same-chain USDC swap checks for Polygon
  return [
    {
      name: `${config.usdc.amount} USDC same-chain swap on Polygon`,
      group: "lifi_swap",
      url: `https://li.quest/v1/quote?fromChain=137&toChain=137&fromToken=${config.usdc.polygon}&toToken=${config.usdc.polygon}&fromAmount=${config.usdc.amountWei}&fromAddress=${config.usdc.address}&toAddress=${config.usdc.address}&integrator=wayfinder`,
      interval: config.global.interval,
      conditions: [
        "[STATUS] == 200",
        "[BODY].status == UP",
        `[RESPONSE_TIME] < ${config.global.responseTimes.lifi_swap}`,
      ],
    },
  ];
}

function generateHttpChecks() {
  return config.http.endpoints.map((endpoint) => ({
    name: endpoint.name,
    group: endpoint.group,
    url: endpoint.url,
    interval: config.global.interval,
    conditions: [
      `[STATUS] == ${endpoint.expectedStatus}`,
      `[RESPONSE_TIME] < ${config.global.responseTimes.http}`,
    ],
  }));
}

// Generate configuration object
const configuration = {
  endpoints: [
    ...generateLifiChecks(),
    ...generateUsdcChecks(),
    ...generateHttpChecks(),
  ],
};

// Write YAML file with proper formatting
fs.writeFileSync("config.yaml", yaml.dump(configuration, { indent: 2 }));

console.log("Configuration generated successfully!");
