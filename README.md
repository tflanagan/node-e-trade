e-trade
=======

[![npm license](https://img.shields.io/npm/l/e-trade-api.svg)](https://www.npmjs.com/package/e-trade-api) [![npm version](https://img.shields.io/npm/v/e-trade-api.svg)](https://www.npmjs.com/package/e-trade-api) [![npm downloads](https://img.shields.io/npm/dm/e-trade-api.svg)](https://www.npmjs.com/package/e-trade-api)

A promise, JSON-based library for interacting with the E-Trade API.

Written in TypeScript.

Install
-------
```
$ npm install e-trade
```

Example
-------
```typescript
import { ETrade } from 'e-trade-api';

const eTrade = new ETrade({
	key: 'key',
	secret: 'secret'
});

(async () => {
	try {
		const requestTokenResults = await eTrade.requestToken();

		// Visit url, authorize application, copy/paste code below

		const accessTokenResults = await eTrade.getAccessToken({
			key: requestTokenResults.oauth_token,
			secret: requestTokenResults.oauth_token_secret,
			code: 'code from requestTokenResults.url'
		});

		eTrade.settings.accessToken = accessTokenResults.oauth_token;
		eTrade.settings.accessSecret = accessTokenResults.oauth_token_secret;

		/*
		await eTrade.renewAccessToken({
			key: eTrade.settings.accessToken,
			secret: eTrade.settings.accessSecret
		});

		await eTrade.revokeAccessToken({
			key: eTrade.settings.accessToken,
			secret: eTrade.settings.accessSecret
		});
		*/

		let results = await eTrade.listAccounts();

		console.log(results[0].accountName);

		results = await eTrade.getAccountBalances({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx'
		});

		console.log(results);

		results = await eTrade.listTransactions({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx'
		});

		console.log(results);

		results = await eTrade.listTransactionDetails({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx',
			transactionId: 10000000000000
		});

		console.log(results);

		results = await eTrade.viewPortfolio({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx'
		});

		console.log(results);

		results = await eTrade.listAlerts();

		console.log(results);

		results = await eTrade.listAlertDetails({
			alertId: 1000
		});

		console.log(results);

		results = await eTrade.deleteAlert(1000);

		console.log(results);

		results = await eTrade.getQuotes({
			symbols: [
				'TSLA',
				'GOOG'
			]
		});

		console.log(results);

		results = await eTrade.lookupProduct('TSLA');

		console.log(results);

		results = await eTrade.getOptionChains({
			symbol: 'TSLA'
		});

		console.log(results);

		results = await eTrade.getOptionExpireDates({
			symbol: 'TSLA'
		});

		console.log(results);

		results = await eTrade.listOrders({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx'
		});

		console.log(results);

		results = await eTrade.previewOrder({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx',
			orderType: 'EQ',
			order: [{
				allOrNone: true,
				priceType: 'LIMIT',
				orderTerm: 'GOOD_FOR_DAY',
				marketSession: 'REGULAR',
				stopPrice: '',
				limitPrice: 50,
				Instrument: [{
					Product: {
						securityType: 'EQ',
						symbol: 'FB'
					},
					orderAction: 'BUY',
					quantityType: 'QUANTITY',
					quantity: 10
				}]
			}],
			clientOrderId: Date.now()
		});

		console.log(results);

		results = await eTrade.changePreviewedOrder({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx',
			orderId: 773,
			orderType: 'EQ',
			order: [{
				allOrNone: true,
				priceType: 'LIMIT',
				orderTerm: 'GOOD_FOR_DAY',
				marketSession: 'REGULAR',
				stopPrice: '',
				limitPrice: 50,
				Instrument: [{
					Product: {
						securityType: 'EQ',
						symbol: 'FB'
					},
					orderAction: 'BUY',
					quantityType: 'QUANTITY',
					quantity: 10
				}]
			}],
			clientOrderId: Date.now()
		});

		console.log(results);

		results = await eTrade.placeOrder({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx',
			orderType: 'EQ',
			order: [{
				allOrNone: true,
				priceType: 'LIMIT',
				orderTerm: 'GOOD_FOR_DAY',
				marketSession: 'REGULAR',
				stopPrice: '',
				limitPrice: 50,
				Instrument: [{
					Product: {
						securityType: 'EQ',
						symbol: 'FB'
					},
					orderAction: 'BUY',
					quantityType: 'QUANTITY',
					quantity: 10
				}]
			}],
			clientOrderId: 1589230557234,
			previewIds: [{
				previewId: 1627181131
			}]
		});

		console.log(results);

		results = await eTrade.cancelOrder({
			accountIdKey: 'xxxxxxxxxxxxxxxxxxxxxx',
			orderId: 529
		});

		console.log(results);
	}catch(err){
		console.error(err);
	}
})();
```
