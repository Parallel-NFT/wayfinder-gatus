const fs = require('fs');
const yaml = require('yaml-boost');

// Configuration for different check types
const config = {
    global: {
        interval: '5m',
        maxResponseTime: 150
    },
    lifi: {
        amount: '0.1',
        amountWei: '10000000000000000',
        address: '0x8Ab2ec87870FCde4B11E4a67423107A723626671',
        chains: [
            { name: 'Base', id: '8453' },
            { name: 'Mainnet', id: '1' },
            { name: 'Arbitrum', id: '42161' },
            { name: 'BNB', id: '56' }
        ]
    },
    http: {
        endpoints: [
            {
                name: 'Example API Health Check',
                group: 'api-health',
                url: 'https://api.example.com/health',
                expectedStatus: 200
            }
        ]
    }
};

function generateLifiChecks() {
    return config.lifi.chains.flatMap((fromChain, i) => 
        config.lifi.chains.flatMap((toChain, j) => 
            i === j ? [] : [{
                name: `${config.lifi.amount} native on ${fromChain.name} -> X native on ${toChain.name}`,
                group: 'lifi',
                url: `https://li.quest/v1/quote?fromChain=${fromChain.id}&toChain=${toChain.id}&fromToken=0x0000000000000000000000000000000000000000&toToken=0x0000000000000000000000000000000000000000&fromAmount=${config.lifi.amountWei}&fromAddress=${config.lifi.address}&toAddress=${config.lifi.address}&integrator=wayfinder&denyExchanges=1inch`,
                interval: config.global.interval,
                conditions: [
                    '[STATUS] == 200',
                    '[BODY].status == UP',
                    `[RESPONSE_TIME] < ${config.global.maxResponseTime}`
                ]
            }]
        )
    );
}

function generateHttpChecks() {
    return config.http.endpoints.map(endpoint => ({
        name: endpoint.name,
        group: endpoint.group,
        url: endpoint.url,
        interval: config.global.interval,
        conditions: [
            `[STATUS] == ${endpoint.expectedStatus}`,
            `[RESPONSE_TIME] < ${config.global.maxResponseTime}`
        ]
    }));
}

// Generate configuration object
const configuration = {
    endpoints: [
        ...generateLifiChecks(),
        ...generateHttpChecks()
    ]
};

// Write YAML file with proper formatting
fs.writeFileSync('config.yaml', yaml.dump(configuration, { indent: 2 }));

console.log('Configuration generated successfully!');
