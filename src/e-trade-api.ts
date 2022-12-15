'use strict';

/* Dependencies */
import merge from 'deepmerge';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import {
	parse as parseQueryString
} from 'querystring';
import { debug } from 'debug';
import { Throttle } from 'generic-throttle';
import axios, {
	AxiosRequestConfig
} from 'axios';

/* Debug */
const debugRequest = debug('e-trade:request');
const debugResponse = debug('e-trade:response');

/* Globals */
const VERSION = require('../package.json').version;

/* Main Class */
export class ETrade {

	static VERSION: string = VERSION;

	static defaults: ETradeOptions = {
		mode: 'dev',

		key: '',
		secret: '',

		accessToken: '',
		accessSecret: '',

		urls: {
			oauth: 'https://api.etrade.com/oauth/',
			prod: 'https://api.etrade.com/v1/',
			dev: 'https://apisb.etrade.com/v1/'
		},

		connectionLimit: 10,
		connectionLimitPeriod: 1000,
		errorOnConnectionLimit: false,

		proxy: false
	};

	public settings: ETradeOptions;

	private _id: number = 0;
	private throttle: Throttle;
	private oauth: OAuth;

	constructor(options?: Partial<ETradeOptions>){
		this.settings = merge(ETrade.defaults, options || {});

		this.throttle = new Throttle(this.settings.connectionLimit, this.settings.connectionLimitPeriod, this.settings.errorOnConnectionLimit);

		this.oauth = new OAuth({
			consumer: {
				key: this.settings.key,
				secret: this.settings.secret
			},
			signature_method: 'HMAC-SHA1',
			hash_function(base_string, key) {
				return crypto.createHmac('sha1', key).update(base_string).digest('base64');
			}
		});
	}

	private getBasicRequest(requestOptions?: AxiosRequestConfig): AxiosRequestConfig {
		return merge({
			method: 'GET',
			baseURL: this.settings.mode === 'prod' ? this.settings.urls.prod : this.settings.urls.dev,
			headers: {
				'User-Agent': `node-e-trade/v${VERSION} nodejs/${process.version}`
			},
			proxy: this.settings.proxy
		}, requestOptions || {});
	}

	private signRequest(request: AxiosRequestConfig, token?: boolean | { key: string; secret: string; }, omit: boolean = false): void {
		const options = merge({}, request);

		options.url = [
			options.baseURL || '',
			options.url || ''
		].join('');

		// TODO: implement proper fix
		// @ts-ignore - TS2790
		delete options.baseURL;

		if(token === undefined || token === true){
			token = {
				key: this.settings.accessToken,
				secret: this.settings.accessSecret
			};
		}

		if(omit){
			delete options.data;
		}

		const authorization: any = this.oauth.authorize(options, token === false ? undefined : token);

		if(!request.params){
			request.params = {};
		}

		Object.keys(authorization).filter((key) => {
			return !omit || key.startsWith('oauth');
		}).forEach((key) => {
			request.params[key] = authorization[key];
		});
	}

	private async request<T>(options: AxiosRequestConfig): Promise<T> {
		return await this.throttle.acquire(async () => {
			const id = 0 + (++this._id);

			debugRequest(id, options);

			try {
				const results = (await axios.request(options)).data;

				debugResponse(id, results);

				return results;
			}catch(err: any){
				if(err.response){
					const nErr: ETradeError = new Error(err.response.statusText);

					nErr.code = err.response.status;

					if(err.response.data.Error){
						if(err.response.data.Error.code){
							nErr.code = err.response.data.Error.code;
						}

						nErr.message = err.response.data.Error.message;
					}

					nErr.raw = err.response.data;

					err = nErr;
				}

				debugResponse(id, err);

				throw err;
			}
		});
	}

	/* OAuth Related Methods */

	async getAccessToken(options: GetAccessTokenRequest): Promise<GetAccessTokenResponse> {
		const requestOptions = this.getBasicRequest();

		delete requestOptions.baseURL;

		requestOptions.url = [
			this.settings.urls.oauth,
			'access_token'
		].join('');

		requestOptions.data = {
			oauth_verifier: options.code
		};

		this.signRequest(requestOptions, {
			key: options.key,
			secret: options.secret
		});

		const results = parseQueryString(await this.request<any>(requestOptions));

		return {
			oauth_token: '' + results.oauth_token,
			oauth_token_secret: '' + results.oauth_token_secret
		};
	}

	async renewAccessToken(options: RenewAccessTokenRequest){
		const requestOptions = this.getBasicRequest();

		delete requestOptions.baseURL;

		requestOptions.url = [
			this.settings.urls.oauth,
			'renew_access_token'
		].join('');

		this.signRequest(requestOptions, {
			key: options.key,
			secret: options.secret
		});

		return await this.request<any>(requestOptions);
	}

	async requestToken(): Promise<RequestTokenResponse> {
		const requestOptions = this.getBasicRequest();

		delete requestOptions.baseURL;

		requestOptions.url = [
			this.settings.urls.oauth,
			'request_token'
		].join('');

		requestOptions.data = {
			oauth_callback: 'oob'
		};

		this.signRequest(requestOptions, false);

		const results = parseQueryString(await this.request<string>(requestOptions));

		return {
			oauth_token: '' + results.oauth_token,
			oauth_token_secret: '' + results.oauth_token_secret,
			oauth_callback_confirmed: results.oauth_callback_confirmed === 'true',
			url: `https://us.etrade.com/e/t/etws/authorize?key=${this.settings.key}&token=${results.oauth_token}`
		};
	}

	async revokeAccessToken(options: RenewAccessTokenRequest){
		const requestOptions = this.getBasicRequest();

		delete requestOptions.baseURL;

		requestOptions.url = [
			this.settings.urls.oauth,
			'revoke_access_token'
		].join('');

		this.signRequest(requestOptions, {
			key: options.key,
			secret: options.secret
		});

		return await this.request<any>(requestOptions);
	}

	/* E-Trade API */

	async cancelOrder({ accountIdKey, orderId }: CancelOrderRequest): Promise<CancelOrderResponse> {
		const requestOptions = this.getBasicRequest({
			method: 'PUT',
			url: `accounts/${accountIdKey}/orders/cancel.json`,
			data: {
				CancelOrderRequest: {
					orderId: orderId
				}
			}
		});

		this.signRequest(requestOptions, undefined, true);

		return (await this.request<any>(requestOptions)).CancelOrderResponse;
	}

	async changePreviewedOrder({ accountIdKey, orderId, orderType, clientOrderId, order }: ChangePreviewedOrderRequest): Promise<PreviewOrderResponse> {
		const requestOptions = this.getBasicRequest({
			method: 'PUT',
			url: `accounts/${accountIdKey}/orders/${orderId}/change/preview.json`,
			data: {
				PreviewOrderRequest: {
					orderType: orderType,
					clientOrderId: clientOrderId,
					Order: order
				}
			}
		});

		this.signRequest(requestOptions, undefined, true);

		return (await this.request<any>(requestOptions)).PreviewOrderResponse;
	}

	async deleteAlert(alertId: number | number[]): Promise<DeleteAlertResponse> {
		const requestOptions = this.getBasicRequest({
			method: 'DELETE',
			url: `user/alerts/${(typeof alertId === 'number' ? alertId : alertId.join(','))}.json`
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).AlertsResponse;
	}

 	async getAccountBalances({ accountIdKey, accountType, instType = 'BROKERAGE', realTimeNAV = true }: GetAccountBalancesRequest): Promise<GetAccountBalancesResponse> {
		const data: Partial<GetAccountBalancesRequest> = {
			instType: instType,
			realTimeNAV: realTimeNAV
		};

		if(accountType){
			data.accountType = accountType;
		}

		const requestOptions = this.getBasicRequest({
			url: `accounts/${accountIdKey}/balance.json`,
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).BalanceResponse;
	}

	async getOptionChains({ symbol, expiryYear, expiryMonth, expiryDay, strikePriceNear, noOfStrikes, includeWeekly = false, skipAdjusted = true, optionCategory = 'STANDARD', chainType = 'CALLPUT', priceType = 'ATNM' }: GetOptionChainsRequest): Promise<GetOptionChainsResponse> {
		const data: Partial<GetOptionChainsRequest> = {
			symbol: symbol,
			includeWeekly: includeWeekly,
			skipAdjusted: skipAdjusted,
			optionCategory: optionCategory,
			chainType: chainType,
			priceType: priceType
		};

		if(expiryYear){
			data.expiryYear = expiryYear;
		}

		if(expiryMonth){
			data.expiryMonth = expiryMonth;
		}

		if(expiryDay){
			data.expiryDay = expiryDay;
		}

		if(strikePriceNear !== undefined){
			data.strikePriceNear = strikePriceNear;
		}

		if(noOfStrikes !== undefined){
			data.noOfStrikes = noOfStrikes;
		}

		const requestOptions = this.getBasicRequest({
			url: 'market/optionchains.json',
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).OptionChainResponse;
	}

	async getOptionExpireDates({ symbol, expiryType }: GetOptionExpireDatesRequest): Promise<ExpirationDate[]> {
		const data: Partial<GetOptionExpireDatesRequest> = {
			symbol: symbol
		};

		if(expiryType){
			data.expiryType = expiryType;
		}

		const requestOptions = this.getBasicRequest({
			url: 'market/optionexpiredate.json',
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).OptionExpireDateResponse.ExpirationDate;
	}

	async getQuotes({ symbols, detailFlag, requireEarningsDate = false, overrideSymbolCount = false, skipMiniOptionsCheck = false }: GetQuotesRequest): Promise<QuoteData> {
		const data: Partial<GetQuotesRequest> = {
			requireEarningsDate: requireEarningsDate,
			overrideSymbolCount: overrideSymbolCount,
			skipMiniOptionsCheck: skipMiniOptionsCheck
		};

		if(detailFlag){
			data.detailFlag = detailFlag;
		}

		const requestOptions = this.getBasicRequest({
			url: `market/quote/${typeof(symbols) === 'string' ? symbols : symbols.join(',')}.json`,
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).QuoteResponse.QuoteData[0];
	}

	async listAccounts(): Promise<Account[]> {
		const requestOptions = this.getBasicRequest({
			url: 'accounts/list.json'
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).AccountListResponse.Accounts.Account;
	}

	async listAlertDetails({ alertId, htmlTags = false }: ListAlertDetailsRequest): Promise<AlertDetails> {
		const requestOptions = this.getBasicRequest({
			url: `user/alerts/${alertId}.json`,
			data: {
				htmlTags: htmlTags
			}
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).AlertDetailsResponse;
	}

	async listAlerts(options?: ListAlertsRequest): Promise<ListAlertsResponse> {
		const data: Partial<ListAlertsRequest> = {};

		if(options){
			if(options.count){
				data.count = options.count;
			}

			if(options.category){
				data.category = options.category;
			}

			if(options.status){
				data.status = options.status;
			}

			if(options.direction){
				data.direction = options.direction;
			}

			if(options.search){
				data.search = options.search;
			}
		}

		const requestOptions = this.getBasicRequest({
			url: 'user/alerts.json',
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).AlertsResponse;
	}

	async listOrders({ accountIdKey, marker, count, status, fromDate, toDate, symbol, securityType, transactionType, marketSession }: ListOrdersRequest): Promise<ListOrdersResponse> {
		const data: Partial<ListOrdersRequest> = {};

		if(marker){
			data.marker = marker;
		}

		if(count){
			data.count = count;
		}

		if(status){
			data.status = status;
		}

		if(fromDate){
			data.fromDate = fromDate;
		}

		if(toDate){
			data.toDate = toDate;
		}

		if(symbol){
			data.symbol = symbol;
		}

		if(securityType){
			data.securityType = securityType;
		}

		if(transactionType){
			data.transactionType = transactionType;
		}

		if(marketSession){
			data.marketSession = marketSession;
		}

		const requestOptions = this.getBasicRequest({
			url: `accounts/${accountIdKey}/orders.json`,
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).OrdersResponse;
	}

	async listOrderDetails({ accountIdKey, orderId }: ListOrderDetailsRequest): Promise<ListOrderDetailsResponse> {
		const requestOptions = this.getBasicRequest({
				url: `accounts/${accountIdKey}/orders/${orderId}.json`,
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).OrdersResponse.Order[0];
}

	async listTransactionDetails({ accountIdKey, transactionId, storeId }: ListTransactionDetailsRequest): Promise<Transaction> {
		const data: Partial<ListTransactionDetailsRequest> = {};

		if(storeId){
			data.storeId = storeId;
		}

		const requestOptions = this.getBasicRequest({
			url: `accounts/${accountIdKey}/transactions/${transactionId}.json`,
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).TransactionDetailsResponse;
	}

	async listTransactions({ accountIdKey, startDate, endDate, sortOrder, marker, count }: ListTransactionsRequest): Promise<ListTransactionsResponse> {
		const data: Partial<ListTransactionsRequest> = {};

		if(startDate){
			data.startDate = startDate;
		}

		if(endDate){
			data.endDate = endDate;
		}

		if(sortOrder){
			data.sortOrder = sortOrder;
		}

		if(marker){
			data.marker = marker;
		}

		if(count){
			data.count = count;
		}

		const requestOptions = this.getBasicRequest({
			url: `accounts/${accountIdKey}/transactions.json`,
			data: data
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).TransactionListResponse;
	}

	async lookupProduct(search: string): Promise<LookupProductResponse[]> {
		const requestOptions = this.getBasicRequest({
			url: `market/lookup/${search}.json`
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).LookupResponse.Data;
	}

	async placeChangedOrder({ accountIdKey, orderId, orderType, order, clientOrderId, previewIds }: PlaceChangedOrderRequest): Promise<PlaceOrderResponse> {
		const requestOptions = this.getBasicRequest({
			method: 'PUT',
			url: `accounts/${accountIdKey}/orders/${orderId}/change/place.json`,
			data: {
				PlaceOrderRequest: {
					orderType: orderType,
					clientOrderId: clientOrderId,
					Order: order,
					PreviewIds: previewIds
				}
			}
		});

		this.signRequest(requestOptions, undefined, true);

		return (await this.request<any>(requestOptions)).PlaceOrderResponse;
	}

	async placeOrder({ accountIdKey, orderType, order, clientOrderId, previewIds }: PlaceOrderRequest): Promise<PlaceOrderResponse> {
		const requestOptions = this.getBasicRequest({
			method: 'POST',
			url: `accounts/${accountIdKey}/orders/place.json`,
			data: {
				PlaceOrderRequest: {
					orderType: orderType,
					clientOrderId: clientOrderId,
					Order: order,
					PreviewIds: previewIds
				}
			}
		});

		this.signRequest(requestOptions, undefined, true);

		return (await this.request<any>(requestOptions)).PlaceOrderResponse;
	}

	async previewOrder({ accountIdKey, orderType, order, clientOrderId }: PreviewOrderRequest): Promise<PreviewOrderResponse> {
		const requestOptions = this.getBasicRequest({
			method: 'POST',
			url: `accounts/${accountIdKey}/orders/preview.json`,
			data: {
				PreviewOrderRequest: {
					orderType: orderType,
					clientOrderId: clientOrderId,
					Order: order
				}
			}
		});

		this.signRequest(requestOptions, undefined, true);

		return (await this.request<any>(requestOptions)).PreviewOrderResponse;
	}

	async viewLotsDetails({ accountIdKey, positionId }: ViewLotsDetailsRequest): Promise<ViewLotsDetailsResponse> {
		const requestOptions = this.getBasicRequest({
			url: `accounts/${accountIdKey}/portfolio/${positionId}.json`
		});

		this.signRequest(requestOptions);

		return (await this.request<any>(requestOptions)).PositionLotsResponse;
	}

	async viewPortfolio({ accountIdKey, count, sortBy, sortOrder = 'DESC', marketSession = 'REGULAR', totalsRequired = false, lotsRequired = false, view = 'QUICK' }: ViewPortfolioRequest): Promise<Portfolio[]> {
		const data: Partial<ViewPortfolioRequest> = {
			sortOrder: sortOrder,
			marketSession: marketSession,
			totalsRequired: totalsRequired,
			lotsRequired: lotsRequired,
			view: view
		};

		if(count){
			data.count = count;
		}

		if(sortBy){
			data.sortBy = sortBy;
		}

		const requestOptions = this.getBasicRequest({
			url: `accounts/${accountIdKey}/portfolio.json`,
			data: data
		});

		this.signRequest(requestOptions);

		const response = await this.request<any>(requestOptions);

		return response?.PortfolioResponse?.AccountPortfolio || {};
	}

}

/* Interfaces / Types */
export type accountMode = 'CASH' | 'MARGIN';
export type institutionType = 'BROKERAGE';
export type accountType = 'AMMCHK' | 'ARO' | 'BCHK' | 'BENFIRA' | 'BENFROTHIRA' | 'BENF_ESTATE_IRA' | 'BENF_MINOR_IRA' | 'BENF_ROTH_ESTATE_IRA' | 'BENF_ROTH_MINOR_IRA' | 'BENF_ROTH_TRUST_IRA' | 'BENF_TRUST_IRA' | 'BRKCD' | 'BROKER' | 'CASH' | 'C_CORP' | 'CONTRIBUTORY' | 'COVERDELL_ESA' | 'CONVERSION_ROTH_IRA' | 'CREDITCARD' | 'COMM_PROP' | 'CONSERVATOR' | 'CORPORATION' | 'CSA' | 'CUSTODIAL' | 'DVP' | 'ESTATE' | 'EMPCHK' | 'EMPMMCA' | 'ETCHK' | 'ETMMCHK' | 'HEIL' | 'HELOC' | 'INDCHK' | 'INDIVIDUAL' | 'INDIVIDUAL_K' | 'INVCLUB' | 'INVCLUB_C_CORP' | 'INVCLUB_LLC_C_CORP' | 'INVCLUB_LLC_PARTNERSHIP' | 'INVCLUB_LLC_S_CORP' | 'INVCLUB_PARTNERSHIP' | 'INVCLUB_S_CORP' | 'INVCLUB_TRUST' | 'IRA_ROLLOVER' | 'JOINT' | 'JTTEN' | 'JTWROS' | 'LLC_C_CORP' | 'LLC_PARTNERSHIP' | 'LLC_S_CORP' | 'LLP' | 'LLP_C_CORP' | 'LLP_S_CORP' | 'IRA' | 'IRACD' | 'MONEY_PURCHASE' | 'MARGIN' | 'MRCHK' | 'MUTUAL_FUND' | 'NONCUSTODIAL' | 'NON_PROFIT' | 'OTHER' | 'PARTNER' | 'PARTNERSHIP' | 'PARTNERSHIP_C_CORP' | 'PARTNERSHIP_S_CORP' | 'PDT_ACCOUNT' | 'PM_ACCOUNT' | 'PREFCD' | 'PREFIRACD' | 'PROFIT_SHARING' | 'PROPRIETARY' | 'REGCD' | 'ROTHIRA' | 'ROTH_INDIVIDUAL_K' | 'ROTH_IRA_MINORS' | 'SARSEPIRA' | 'S_CORP' | 'SEPIRA' | 'SIMPLE_IRA' | 'TIC' | 'TRD_IRA_MINORS' | 'TRUST' | 'VARCD' | 'VARIRACD';
export type accountStatus = 'ACTIVE' | 'CLOSED';
export type sortBy = 'SYMBOL' | 'TYPE_NAME' | 'EXCHANGE_NAME' | 'CURRENCY' | 'QUANTITY' | 'LONG_OR_SHORT' | 'DATE_ACQUIRED' | 'PRICEPAID' | 'TOTAL_GAIN' | 'TOTAL_GAIN_PCT' | 'MARKET_VALUE' | 'BI' | 'ASK' | 'PRICE_CHANGE' | 'PRICE_CHANGE_PCT' | 'VOLUME' | 'WEEK_52_HIGH' | 'WEEK_52_LOW' | 'EPS' | 'PE_RATIO' | 'OPTION_TYPE' | 'STRIKE_PRICE' | 'PREMIUM' | 'EXPIRATION' | 'DAYS_GAIN' | 'COMMISSION' | 'MARKETCAP' | 'PREV_CLOSE' | 'OPEN' | 'DAYS_RANGE' | 'TOTAL_COST' | 'DAYS_GAIN_PCT' | 'PCT_OF_PORTFOLIO' | 'LAST_TRADE_TIME' | 'BASE_SYMBOL_PRICE' | 'WEEK_52_RANGE' | 'LAST_TRADE' | 'SYMBOL_DESC' | 'BID_SIZE' | 'ASK_SIZE' | 'OTHER_FEES' | 'HELD_AS' | 'OPTION_MULTIPLIER' | 'DELIVERABLES' | 'COST_PERSHARE' | 'DIVIDEND' | 'DIV_YIELD' | 'DIV_PAY_DATE' | 'EST_EARN' | 'EX_DIV_DATE' | 'TEN_DAY_AVG_VOL' | 'BETA' | 'BID_ASK_SPREAD' | 'MARGINABLE' | 'DELTA_52WK_HI' | 'DELTA_52WK_LOW' | 'PERF_1MON' | 'ANNUAL_DIV' | 'PERF_12MON' | 'PERF_3MON' | 'PERF_6MON' | 'PRE_DAY_VOL' | 'SV_1MON_AVG' | 'SV_10DAY_AVG' | 'SV_20DAY_AVG' | 'SV_2MON_AVG' | 'SV_3MON_AVG' | 'SV_4MON_AVG' | 'SV_6MON_AVG' | 'DELTA' | 'GAMMA' | 'IV_PCT' | 'THETA' | 'VEGA' | 'ADJ_NONADJ_FLAG' | 'DAYS_EXPIRATION' | 'OPEN_INTEREST' | 'INSTRINIC_VALUE' | 'RHO' | 'TYPE_CODE' | 'DISPLAY_SYMBOL' | 'AFTER_HOURS_PCTCHANGE' | 'PRE_MARKET_PCTCHANGE' | 'EXPAND_COLLAPSE_FLAG';
export type sortOrder = 'ASC' | 'DESC';
export type marketSession = 'REGULAR' | 'EXTENDED';
export type view = 'PERFORMANCE' | 'FUNDAMENTAL' | 'OPTIONSWATCH' | 'QUICK' | 'COMPLETE';
export type category = 'STOCK' | 'ACCOUNT';
export type alertStatus = 'UNREAD' | 'READ' | 'DELETED' | 'UNDELETED';
export type detailFlag = 'ALL' | 'FUNDAMENTAL' | 'INTRADAY' | 'OPTIONS' | 'WEEK_52' | 'MF_DETAIL';
export type quoteStatus = 'REALTIME' | 'DELAYED' | 'CLOSING' | 'EH_REALTIME' | 'EH_BEFORE_OPEN' | 'EH_CLOSED';
export type optionCategory = 'STANDARD' | 'ALL' | 'MINI';
export type chainType = 'CALL' | 'PUT' | 'CALLPUT';
export type priceType = 'ATNM' | 'ALL';
export type expiryType = 'UNSPECIFIED' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'VIX' | 'ALL' | 'MONTHEND';
export type transactionType = 'ATNM' | 'BUY' | 'SELL' | 'SELL_SHORT' | 'BUY_TO_COVER' | 'MF_EXCHANGE';
export type securityType = 'EQ' | 'OPTN' | 'BOND' | 'MF' | 'MMF';
export type orderStatus = 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'INDIVIDUAL_FILLS' | 'CANCEL_REQUESTED' | 'EXPIRED' | 'REJECTED' | 'PARTIAL' | 'OPTION_EXERCISE' | 'OPTION_ASSIGNMENT' | 'DO_NOT_EXERCISE' | 'DONE_TRADE_EXECUTED';
export type orderType = 'EQ' | 'OPTN' | 'SPREADS' | 'BUY_WRITES' | 'BUTTERFLY' | 'IRON_BUTTERFLY' | 'CONDOR' | 'IRON_CONDOR' | 'MF' | 'MMF' | 'BOND' | 'CONTINGENT' | 'ONE_CANCELS_ALL' | 'ONE_TRIGGERS_ALL' | 'ONE_TRIGGERS_OCO' | 'OPTION_EXERCISE' | 'OPTION_ASSIGNMENT' | 'OPTION_EXPIRED' | 'DO_NOT_EXERCISE' | 'BRACKETED';
export type orderTerm = 'GOOD_UNTIL_CANCEL' | 'GOOD_FOR_DAY' | 'GOOD_TILL_DATE' | 'IMMEDIATE_OR_CANCEL' | 'FILL_OR_KILL';
export type orderPriceType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' | 'TRAILING_STOP_CNST_BY_LOWER_TRIGGER' | 'UPPER_TRIGGER_BY_TRAILING_STOP_CNST' | 'TRAILING_STOP_PRCT_BY_LOWER_TRIGGER' | 'UPPER_TRIGGER_BY_TRAILING_STOP_PRCT' | 'TRAILING_STOP_CNST' | 'TRAILING_STOP_PRCT' | 'HIDDEN_STOP' | 'HIDDEN_STOP_BY_LOWER_TRIGGER' | 'UPPER_TRIGGER_BY_HIDDEN_STOP' | 'NET_DEBIT' | 'NET_CREDIT' | 'NET_EVEN' | 'MARKET_ON_OPEN' | 'MARKET_ON_CLOSE' | 'LIMIT_ON_OPEN' | 'LIMIT_ON_CLOSE';
export type offsetType = 'TRAILING_STOP_CNST' | 'TRAILING_STOP_PRCT';
export type routingDestination = 'AUTO' | 'AMEX' | 'BOX' | 'CBOE' | 'ISE' | 'NOM' | 'NYSE' | 'PHX';
export type conditionType = 'CONTINGENT_GTE' | 'CONTINGENT_LTE';
export type conditionFollowPrice = 'ASK' | 'BID' | 'LAST';
export type positionQuantity = 'ENTIRE_POSITION' | 'CASH' | 'MARGIN';
export type egQual = 'EG_QUAL_UNSPECIFIED' | 'EG_QUAL_QUALIFIED' | 'EG_QUAL_NOT_IN_FORCE' | 'EG_QUAL_NOT_A_MARKET_ORDER' | 'EG_QUAL_NOT_AN_ELIGIBLE_SECURITY' | 'EG_QUAL_INVALID_ORDER_TYPE' | 'EG_QUAL_SIZE_NOT_QUALIFIED' | 'EG_QUAL_OUTSIDE_GUARANTEED_PERIOD' | 'EG_QUAL_INELIGIBLE_GATEWAY' | 'EG_QUAL_INELIGIBLE_DUE_TO_IPO' | 'EG_QUAL_INELIGIBLE_DUE_TO_SELF_DIRECTED' | 'EG_QUAL_INELIGIBLE_DUE_TO_CHANGEORDER';
export type reInvestOption = 'REINVEST' | 'DEPOSIT' | 'CURRENT_HOLDING';
export type orderAction = 'BUY' | 'SELL' | 'BUY_TO_COVER' | 'SELL_SHORT' | 'BUY_OPEN' | 'BUY_CLOSE' | 'SELL_OPEN' | 'SELL_CLOSE' | 'EXCHANGE';
export type quantityType = 'QUANTITY' | 'DOLLAR' | 'ALL_I_OWN';
export type currency = 'USD' | 'EUR' | 'GBP' | 'HKD' | 'JPY' | 'CAD';
export type mfTransaction = 'BUY' | 'SELL';
export type messageType = 'WARNING' | 'INFO' | 'INFO_HOLD' | 'ERROR';
export type cashMargin = 'CASH' | 'MARGIN';

export interface ETradeOptions {
	mode: 'dev' | 'prod';

	key: string;
	secret: string;

	accessToken: string;
	accessSecret: string;

	urls: {
		oauth: string;
		prod: string;
		dev: string;
	}

	connectionLimit: number;
	connectionLimitPeriod: number;
	errorOnConnectionLimit: boolean;

	proxy: false | {
		host: string;
		port: number;
		auth?: {
			username: string;
			password: string;
		}
	}
}

export interface ETradeError extends Error {
	message: string;
	code?: number;
	raw?: any;
}

export interface RequestTokenResponse {
	oauth_token: string;
	oauth_token_secret: string;
	oauth_callback_confirmed: boolean;
	url: string;
}

export interface GetAccessTokenRequest {
	key: string;
	secret: string;
	code: string;
}

export interface GetAccessTokenResponse {
	oauth_token: string;
	oauth_token_secret: string;
}

export interface RenewAccessTokenRequest {
	key: string;
	secret: string;
}

export interface GetAccountBalancesRequest {
	accountIdKey: string;
	accountType?: accountType;
	instType?: institutionType;
	realTimeNAV?: boolean;
}

export interface GetAccountBalancesResponse {
	accountId: string;
	institutionType: institutionType;
	asOfDate: number;
	accountType: accountType;
	optionLevel: string;
	accountDescription: string;
	quoteMode: number;
	dayTraderStatus: string;
	accountMode: accountMode;
	accountDesc: string;
	OpenCalls: OpenCall[];
	Cash: Cash;
	Margin: Margin;
	Lending: Lending;
	Computed: ComputedBalance;
}

export interface ListTransactionsRequest {
	accountIdKey: string;
	/**
	 * The earliest date to include in the date range, formatted as MMDDYYYY. History is available for two years.
	 */
	startDate?: string;
	/**
	 * The latest date to include in the date range, formatted as MMDDYYYY.
	 */
	endDate?: string;
	sortOrder?: sortOrder;
	/**
	 * Used for pagination, this specifies this starting point of the set of items to return.
	 * To page through all the items, repeat the request with the marker from each previous response until you receive a response with a count less than the one you specified, indicating that there are no more items.
	 */
	marker?: string;
	/**
	 * Number of transactions to return in the response. If specified, must be between 1 and 50 inclusive. Defaults to 50.
	 */
	count?: number;
}

export interface ListTransactionsResponse {
	pageMarkers: string;
	/**
	 * Whether or not there are more transactions on a further page.
	 */
	moreTransactions: boolean;
	/**
	 * Number of transactions in this response. Equivalent to Transaction.length.
	 */
	transactionCount: number;
	/**
	 * Total number of transactions across all pages.
	 */
	totalCount: number;
	/**
	 * URL to retrieve the next set of transactions in the pagination series.
	 */
	next?: string;
	/**
	 * Used for pagination, this marker should be supplied to the next ListTransactionsRequest to fetch the next page.
	 */
	marker?: string;
	Transaction: Transaction[]
}

export interface ListTransactionDetailsRequest {
	accountIdKey: string;
	transactionId: number;
	storeId?: string;
}

export interface ListOrderDetailsRequest {
	accountIdKey: string;
	orderId: number;
}

export interface ViewPortfolioRequest {
	accountIdKey: string;
	count?: number;
	sortBy?: sortBy;
	sortOrder?: sortOrder;
	marketSession?: marketSession;
	totalsRequired?: boolean;
	lotsRequired?: boolean;
	view?: view;
}

export interface ListAlertsRequest {
	count?: number;
	category?: category;
	status?: alertStatus;
	direction?: sortOrder;
	search?: string;
}

export interface ListAlertsResponse {
	totalAlerts: number;
	Alert: Alert[]
}

export interface ListAlertDetailsRequest {
	alertId: number;
	htmlTags?: boolean;
}

export interface DeleteAlertResponse {
	result: 'SUCCESS' | 'ERROR';
	failedAlerts: {
		alertId: number[]
	}
}

export interface GetQuotesRequest {
	symbols: string | string[];
	detailFlag?: detailFlag;
	requireEarningsDate?: boolean;
	overrideSymbolCount?: boolean;
	skipMiniOptionsCheck?: boolean;
}

export interface LookupProductResponse {
	symbol: string;
	description: string;
	type: string;
}

export interface GetOptionChainsRequest {
	symbol: string;
	expiryYear?: number;
	expiryMonth?: number;
	expiryDay?: number;
	strikePriceNear?: number;
	noOfStrikes?: number;
	includeWeekly?: boolean;
	skipAdjusted?: boolean;
	optionCategory?: optionCategory;
	chainType?: chainType;
	priceType?: priceType;
}

export interface GetOptionChainsResponse {
	OptionPair: OptionChainPair[];
	SelectedED: SelectedED;
}

export interface GetOptionExpireDatesRequest {
	symbol: string;
	expiryType?: expiryType;
}

export interface ListOrdersRequest {
	accountIdKey: string;
	marker?: string;
	count?: number;
	status?: orderStatus;
	fromDate?: string;
	toDate?: string;
	symbol?: string;
	securityType?: securityType;
	transactionType?: transactionType;
	marketSession?: marketSession;
}

export interface ListOrdersResponse {
	marker: string;
	next: string;
	Order: Order[]
}

export interface Event {
	name: string;
	dateTime: number;
	Instrument: Partial<Instrument>[];
}

export interface OrderEvents {
	Event: Event[];
}

export interface ListOrderDetailsResponse {
	orderId: number;
	orderType: orderType;
	OrderDetail: OrderDetail[];
	Events: OrderEvents;
}

export interface PreviewOrderRequest {
	accountIdKey: string;
	orderType: orderType;
	order: Partial<OrderDetail>[];
	clientOrderId: string | number;
}

export interface PreviewOrderResponse {
	previewTime: number;
	orderType: string;
	messageList: Messages;
	totalOrderValue: number;
	totalCommission: number;
	orderId: number;
	Order: OrderDetail[],
	dstFlag: boolean;
	optionLevelCd: number;
	marginLevelCd: string;
	isEmployee: boolean;
	commissionMsg: string;
	orderIds: OrderId[];
	placedTime: number;
	accountId: string;
	portfolioMargin: PortfolioMargin;
	disclosure: Disclosure;
	PreviewIds: PreviewId[],
	clientOrderId: string;
}

export interface PlaceOrderRequest {
	accountIdKey: string;
	orderType: orderType;
	order: Partial<OrderDetail>[];
	clientOrderId: string | number;
	previewIds: PreviewId[];
}

export interface PlaceOrderResponse {
	orderType: string;
	MessageList: Messages;
	totalOrderValue: number;
	totalCommission: number;
	OrderIds: { orderId: number }[];
	Order: OrderDetail[];
	dstFlag: boolean;
	optionLevelCd: number;
	marginLevelCd: string;
	isEmployee: boolean;
	commissionMsg: string;
	placedTime: number;
	accountId: string;
	PortfolioMargin: PortfolioMargin;
	Disclosure: Disclosure;
	clientOrderId: string;
}

export interface CancelOrderRequest {
	accountIdKey: string;
	orderId: number
}

export interface CancelOrderResponse {
	accountId: string;
	orderId: number;
	cancelTime: number;
	Messages: Messages;
}

export interface ChangePreviewedOrderRequest extends PreviewOrderRequest {
	orderId: number;
}

export interface PlaceChangedOrderRequest extends PlaceOrderRequest {
	orderId: number;
}

/* E-Trade Interfaces */
export interface PreviewId {
	previewId: number;
	cashMargin?: string;
}

export interface Disclosure {
	ehDisclosureFlag: boolean;
	ahDisclosureFlag: boolean;
	conditionalDisclosureFlag: boolean;
	aoDisclosureFlag: boolean;
	mfFLConsent: boolean;
	mfEOConsent: boolean;
}

export interface OrderId {
	orderId: number;
	cashMargin: cashMargin;
}

export interface Message {
	description: string;
	code: number;
	type: messageType;
}

export interface Messages {
	Message: Message[];
}

export interface MFQuantity {
	cash: number;
	margin: number;
	cusip: string
}

export interface Lot {
	id: number;
	size: number;
}

export interface Lots {
	Lot: Lot[]
}

export interface Instrument {
	Product: Partial<Product>;
	symbolDescription: string;
	orderAction: orderAction;
	quantityType: quantityType;
	quantity: number;
	cancelQuantity: number;
	orderedQuantity: number;
	filledQuantity: number;
	averageExecutionPrice: number;
	estimatedCommission: number;
	estimatedFees: number;
	bid: number;
	ask: number;
	lastprice: number;
	currency: currency;
	Lots: Lots;
	MfQuantity: MFQuantity;
	osiKey: string;
	mfTransaction: mfTransaction;
	reserveOrder: boolean;
	reserveQuantity: number;
}

export interface OrderDetail {
	orderNumber: number;
	accountId: string;
	previewTime: number;
	placedTime: number;
	executedTime: number;
	orderValue: number;
	status: orderStatus;
	orderType: orderType;
	orderTerm: orderTerm;
	priceType: orderPriceType;
	priceValue: string;
	limitPrice: number;
	stopPrice: number | '';
	stopLimitPrice: number;
	offsetType: offsetType;
	offsetValue: number;
	marketSession: marketSession;
	routingDestination: routingDestination;
	bracketedLimitPrice: number;
	initialStopPrice: number;
	trailPrice: number;
	triggerPrice: number;
	conditionPrice: number;
	conditionSymbol: string;
	conditionType: conditionType;
	conditionFollowPrice: conditionFollowPrice;
	conditionSecurityType: string;
	replacedByOrderId: number;
	replacesOrderId: number;
	allOrNone: boolean;
	previewId: number;
	Instrument: Partial<Instrument>[];
	Messages: Messages;
	preClearanceCode: string;
	overrideRestrictedCd: number;
	investmentAmount: number;
	positionQuantity: positionQuantity;
	aipFlag: boolean;
	egQual: egQual;
	reInvestOption: reInvestOption;
	estimatedCommission: number;
	estimatedFees: number;
	estimatedTotalAmount: number;
	netPrice: number;
	netBid: number;
	netAsk: number;
	gcd: number;
	ratio: string;
	mfpriceType: string;
}

export interface Order {
	orderId: number;
	details: string;
	orderType: string;
	totalOrderValue: number;
	totalCommission: number;
	OrderDetail: OrderDetail[];
}

export interface ExpirationDate {
	year: number;
	month: number;
	day: number;
	expiryType: expiryType;
}

export interface OptionDetails {
	optionCategory: string;
	optionRootSymbol: string;
	timeStamp: number;
	adjustedFlag: boolean;
	displaySymbol: string;
	optionType: string;
	strikePrice: number;
	symbol: string;
	bid: number;
	ask: number;
	bidSize: number;
	askSize: number;
	inTheMoney: string;
	volume: number;
	openInterest: number;
	netChange: number;
	lastPrice: number;
	quoteDetail: string;
	osiKey: string;
	OptionGreeks: OptionGreeks;
}

export interface OptionChainPair {
	Call: OptionDetails;
	Put: OptionDetails;
}

export interface SelectedED {
	month: number;
	year: number;
	day: number;
}

export interface QuoteData {
	All: AllQuoteDetails;
	dateTime: string;
	dateTimeUTC: number;
	quoteStatus: quoteStatus;
	ahFlag: string;
	errorMessage: string;
	Fundamental: FundamentalQuoteDetails;
	Intraday: IntradayQuoteDetails;
	Option: OptionQuoteDetails;
	Product: Product;
	Week52: Week52QuoteDetails;
	MutualFund: MutualFund;
	timeZone: string;
	dstFlag: boolean;
	hasMiniOptions: boolean;
}

export interface NetAsset {
	value: number;
	asOfDate: number;
}

export interface Values {
	low: string;
	high: string;
	percent: string;
}

export interface Redemption {
	minMonth: string;
	feePercent: string;
	isFrontEnd: string;
	FrontEndValues: Values[];
	redemptionDurationType: string;
	isSales: string;
	salesDurationType: string;
	SalesValues: Values[];
}

export interface SaleChargeValues {
	lowhigh: string;
	percent: string;
}

export interface MutualFund {
	symbolDescription: string;
	cusip: string;
	changeClose: number;
	previousClose: number;
	transactionFee: string;
	earlyRedemptionFee: string;
	availability: string;
	initialInvestment: number;
	subsequentInvestment: number;
	fundFamily: string;
	fundName: string;
	changeClosePercentage: number;
	timeOfLastTrade: number;
	netAssetValue: number;
	publicOfferPrice: number;
	netExpenseRatio: number;
	grossExpenseRatio: number;
	orderCutoffTime: number;
	salesCharge: string;
	initialIraInvestment: number;
	subsequentIraInvestment: number;
	NetAssets: NetAsset;
	fundInceptionDate: number;
	averageAnnualReturns: number;
	sevenDayCurrentYield: number;
	annualTotalReturn: number;
	weightedAverageMaturity: number;
	averageAnnualReturn1Yr: number;
	averageAnnualReturn3Yr: number;
	averageAnnualReturn5Yr: number;
	averageAnnualReturn10Yr: number;
	high52: number;
	low52: number;
	week52LowDate: number;
	week52HiDate: number;
	exchangeName: string;
	sinceInception: number;
	quarterlySinceInception: number;
	lastTrade: number;
	actual12B1Fee: number;
	performanceAsOfDate: string;
	qtrlyPerformanceAsOfDate: string;
	Redemption: Redemption;
	morningStarCategory: string;
	monthlyTrailingReturn1Y: number;
	monthlyTrailingReturn3Y: number;
	monthlyTrailingReturn5Y: number;
	monthlyTrailingReturn10Y: number;
	etradeEarlyRedemptionFee: string;
	maxSalesLoad: number;
	monthlyTrailingReturnYTD: number;
	monthlyTrailingReturn1M: number;
	monthlyTrailingReturn3M: number;
	monthlyTrailingReturn6M: number;
	qtrlyTrailingReturnYTD: number;
	qtrlyTrailingReturn1M: number;
	qtrlyTrailingReturn3M: number;
	qtrlyTrailingReturn6M: number;
	DeferredSalesCharges: SaleChargeValues[];
	FrontEndSalesCharges: SaleChargeValues[];
	exchangeCode: string;
}

export interface Week52QuoteDetails {
	annualDividend: number;
	companyName: string;
	high52: number;
	lastTrade: number;
	low52: number;
	perf12Months: number;
	previousClose: number;
	symbolDescription: string;
	totalVolume: number;
}

export interface OptionGreeks {
	rho: number;
	vega: number;
	theta: number;
	delta: number;
	gamma: number;
	iv: number;
	currentValue: boolean;
}

export interface OptionQuoteDetails {
	ask: number;
	askSize: number;
	bid: number;
	bidSize: number;
	companyName: string;
	daysToExpiration: number;
	lastTrade: number;
	openInterest: number;
	optionPreviousBidPrice: number;
	optionPreviousAskPrice: number;
	osiKey: string;
	intrinsicValue: number;
	timePremium: number;
	optionMultiplier: number;
	contractSize: number;
	symbolDescription: string;
	OptionGreeks: OptionGreeks;
}

export interface IntradayQuoteDetails {
	ask: number;
	bid: number;
	changeClose: number;
	changeClosePercentage: number;
	companyName: string;
	high: number;
	lastTrade: number;
	low: number;
	totalVolume: number;
}

export interface FundamentalQuoteDetails {
	companyName: string;
	eps: number;
	estEarnings: number;
	high52: number;
	lastTrade: number;
	low52: number;
	symbolDescription: string;
	volume10Day: number;
}

export interface ExtendedHourQuoteDetail {
	lastPrice: number;
	change: number;
	percentChange: number;
	bid: number;
	bidSize: number;
	ask: number;
	askSize: number;
	volume: number;
	timeOfLastTrade: number;
	timeZone: string;
	quoteStatus: quoteStatus;
}

export interface OptionDeliverable {
	rootSymbol: string;
	deliverableSymbol: string;
	deliverableTypeCode: string;
	deliverableExchangeCode: string;
	deliverableStrikePercent: number;
	deliverableCILShares: number;
	deliverableWholeShares: number;
}

export interface AllQuoteDetails {
	adjustedFlag: boolean;
	annualDividend: number;
	ask: number;
	askExchange: string;
	askSize: number;
	askTime: string;
	bid: number;
	bidExchange: string;
	bidSize: number;
	bidTime: string;
	changeClose: number;
	changeClosePercentage: number;
	companyName: string;
	daysToExpiration: number;
	dirLast: string;
	dividend: number;
	eps: number;
	estEarnings: number;
	exDividendDate: number;
	exchgLastTrade: string;
	fsi: string;
	high: number;
	high52: number;
	highAsk: number;
	highBid: number;
	lastTrade: number;
	low: number;
	low52: number;
	lowAsk: number;
	lowBid: number;
	numberOfTrades: number;
	open: number;
	openInterest: number;
	optionStyle: string;
	optionUnderlier: string;
	optionUnderlierExchange: string;
	previousClose: number;
	previousDayVolume: number;
	primaryExchange: string;
	symbolDescription: string;
	todayClose: number;
	totalVolume: number;
	upc: number;
	volume10Day: number;
	OptionDeliverableList: OptionDeliverable[];
	cashDeliverable: number;
	marketCap: number;
	sharesOutstanding: number;
	nextEarningDate: string;
	beta: number;
	yield: number;
	declaredDividend: number;
	dividendPayableDate: number;
	pe: number;
	marketCloseBidSize: number;
	marketCloseAskSize: number;
	marketCloseVolume: number;
	week52LowDate: number;
	week52HiDate: number;
	intrinsicValue: number;
	timePremium: number;
	optionMultiplier: number;
	contractSize: number;
	expirationDate: number;
	EhQuote: ExtendedHourQuoteDetail;
	optionPreviousBidPrice: number;
	optionPreviousAskPrice: number;
	osiKey: string;
	timeOfLastTrade: number;
	averageVolume: number;
}

export interface AlertDetails {
	id: number;
	createTime: number;
	subject: string;
	msgText: string;
	readTime: number;
	deleteTime: number;
}

export interface Alert {
	id: number;
	createTime: number;
	subject: string;
	status: alertStatus;
}

export interface Lending {
	currentBalance: number;
	creditLine: number;
	outstandingBalance: number;
	minPaymentDue: number;
	amountPastDue: number;
	availableCredit: number;
	ytdInterestPaid: number;
	lastYtdInterestPaid: number;
	paymentDueDate: number;
	lastPaymentReceivedDate: number;
	paymentReceivedMtd: number;
}

export interface Margin {
	dtCashOpenOrderReserve: number;
	dtMarginOpenOrderReserve: number;
}

export interface OpenCall {
	minEquityCall: number;
	fedCall: number;
	cashCall: number;
	houseCall: number;
}

export interface RealTimeValues {
	totalAccountValue: number;
	netMv: number;
	netMvLong: number;
	netMvShort: number;
	totalLongValue: number;
}

export interface Position {
	positionId: number;
	accountId: string;
	Product: Product;
	osiKey: string;
	symbolDescription: string;
	dateAcquired: number;
	pricePaid: number;
	price: number;
	commissions: number;
	otherFees: number;
	quantity: number;
	positionIndicator: string;
	positionType: string;
	change: number;
	changePct: number;
	daysGain: number;
	daysGainPct: number;
	marketValue: number;
	totalCost: number;
	totalGain: number;
	totalGainPct: number;
	pctOfPortfolio: number;
	costPerShare: number;
	todayCommissions: number;
	todayFees: number;
	todayPricePaid: number;
	todayQuantity: number;
	quotestatus: string;
	dateTimeUTC: number;
	adjPrevClose: number;
	Performance: PerformanceView;
	Fundamental: FundamentalView;
	OptionsWatch: OptionsWatchView;
	Quick: QuickView;
	Complete: CompleteView;
	lotsDetails: string;
	quoteDetails: string;
	PositionLot: PositionLot[];
}

export interface CompleteView {
	priceAdjustedFlag: boolean;
	price: number;
	adjPrice: number;
	change: number;
	changePct: number;
	prevClose: number;
	adjPrevClose: number;
	volume: number;
	lastTrade: number;
	lastTradeTime: number;
	adjLastTrade: number;
	symbolDescription: string;
	perform1Month: number;
	perform3Month: number;
	perform6Month: number;
	perform12Month: number;
	prevDayVolume: number;
	tenDayVolume: number;
	beta: number;
	sv10DaysAvg: number;
	sv20DaysAvg: number;
	sv1MonAvg: number;
	sv2MonAvg: number;
	sv3MonAvg: number;
	sv4MonAvg: number;
	sv6MonAvg: number;
	week52High: number;
	week52Low: number;
	week52Range: string;
	marketCap: number;
	daysRange: string;
	delta52WkHigh: number;
	delta52WkLow: number;
	currency: string;
	exchange: string;
	marginable: boolean;
	bid: number;
	ask: number;
	bidAskSpread: number;
	bidSize: number;
	askSize: number;
	open: number;
	delta: number;
	gamma: number;
	ivPct: number;
	rho: number;
	theta: number;
	vega: number;
	premium: number;
	daysToExpiration: number;
	intrinsicValue: number;
	openInterest: number;
	optionsAdjustedFlag: boolean;
	deliverablesStr: string;
	optionMultiplier: number;
	baseSymbolAndPrice: string;
	estEarnings: number;
	eps: number;
	peRatio: number;
	annualDividend: number;
	dividend: number;
	divYield: number;
	divPayDate: number;
	exDividendDate: number;
	cusip: string;
	quoteStatus: string;
}

export interface QuickView {
	lastTrade: number;
	lastTradeTime: number;
	change: number;
	changePct: number;
	volume: number;
	quoteStatus: string;
	sevenDayCurrentYield: number;
	annualTotalReturn: number;
	weightedAverageMaturity: number;
}

export interface PositionLot {
	positionId: number;
	positionLotId: number;
	price: number;
	termCode: number;
	daysGain: number;
	daysGainPct: number;
	marketValue: number;
	totalCost: number;
	totalCostForGainPct: number;
	totalGain: number;
	lotSourceCode: number;
	originalQty: number;
	remainingQty: number;
	availableQty: number;
	orderNo: number;
	legNo: number;
	acquiredDate: number;
	locationCode: number;
	exchangeRate: number;
	settlementCurrency: string;
	paymentCurrency: string;
	adjPrice: number;
	commPerShare: number;
	feesPerShare: number;
	premiumAdj: number;
	shortType: number;
}

export interface OptionsWatchView {
	baseSymbolAndPrice: string;
	premium: number;
	lastTrade: number;
	bid: number;
	ask: number;
	quoteStatus: string;
	lastTradeTime: number;
}

export interface FundamentalView {
	lastTrade: number;
	lastTradeTime: number;
	change: number;
	changePct: number;
	peRatio: number;
	eps: number;
	dividend: number;
	divYield: number;
	marketCap: number;
	week52Range: string;
	quoteStatus: string;
}

export interface PerformanceView {
	change: number;
	changePct: number;
	lastTrade: number;
	daysGain: number;
	totalGain: number;
	totalGainPct: number;
	marketValue: number;
	quoteStatus: string;
	lastTradeTime: number;
}

export interface Portfolio {
	accountId: string;
	next: string;
	totalNoOfPages: number;
	nextPageNo: string;
	Position: Position[];
}

export interface PortfolioMargin {
	dtCashOpenOrderReserve: number;
	dtMarginOpenOrderReserve: number;
	liquidatingEquity: number;
	houseExcessEquity: number;
	totalHouseRequirement: number;
	excessEquityMinusRequirement: number;
	totalMarginRqmts: number;
	availExcessEquity: number;
	excessEquity: number;
	openOrderReserve: number;
	fundsOnHold: number;
}

export interface ComputedBalance {
	cashAvailableForInvestment: number;
	cashAvailableForWithdrawal: number;
	totalAvailableForWithdrawal: number;
	netCash: number;
	cashBalance: number;
	settledCashForInvestment: number;
	unSettledCashForInvestment: number;
	fundsWithheldFromPurchasePower: number;
	fundsWithheldFromWithdrawal: number;
	marginBuyingPower: number;
	cashBuyingPower: number;
	dtMarginBuyingPower: number;
	dtCashBuyingPower: number;
	marginBalance: number;
	shortAdjustBalance: number;
	regtEquity: number;
	regtEquityPercent: number;
	accountBalance: number;
	OpenCalls: OpenCall;
	RealTimeValues: RealTimeValues;
	PortfolioMargin: PortfolioMargin;
}

export interface Cash {
	fundsForOpenOrdersCash: number;
	moneyMktBalance: number;
}

interface TransactionBase {
	transactionId: number;
	accountId: string;
	transactionDate: number;
	transactionType: string;
	postDate: number;
	amount: number;
	description: string;
	description2: string;
	memo: string;
	storeId: number;
	imageFlag: boolean;
}

/**
* The Transaction Details endpoint returns objects with captialized keys
*/
export interface TransactionDetail extends TransactionBase {
	Category: Category;
	Brokerage: Brokerage;
}

/**
* The List Transactions endpoint returns objects with lowercased keys
*/
export interface Transaction extends TransactionBase {
	category: Category;
	brokerage: BrokerageBase & { product: Product };
}  

export interface Account {
	accountId: string;
	accountIdKey: string;
	accountMode: string;
	accountDesc: string;
	accountName: string;
	accountType: accountType;
	institutionType: institutionType;
	accountStatus: accountStatus;
	closedDate: number;
}
export interface Category {
	categoryId: string;
	parentId: string;
	categoryName: string;
	parentName: string;
}
export interface Product {
	symbol: string;
	securityType: string;
	securitySubType: string;
	callPut: string;
	expiryYear: number;
	expiryMonth: number;
	expiryDay: number;
	strikePrice: number;
	expiryType: string;
}

export interface BrokerageBase {
	transactionType: string;
	quantity: number;
	price: number;
	settlementCurrency: string;
	paymentCurrency: string;
	fee: number;
	memo: string;
	checkNo: string;
	orderNo: string;
}
export interface Brokerage extends BrokerageBase {
	Product: Product;
}
export interface ViewLotsDetailsRequest {
	accountIdKey: string;
	positionId: number;
}
export interface ViewLotsDetailsResponse {
	shortType: number;
	PositionLot: PositionLot[];
}