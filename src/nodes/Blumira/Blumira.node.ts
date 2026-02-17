import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://api.blumira.com/public-api/v1';

const listOperations = [
	'getMany',
	'getManyFindings',
	'getFindings',
	'getFindingsAll',
	'getAgentDevices',
	'getAgentKeys',
];

const findingsListOperations = ['getFindings', 'getFindingsAll', 'getManyFindings'];

const accountScopedOperations = [
	'get',
	'getFindings',
	'getFinding',
	'getFindingComments',
	'addFindingComment',
	'assignFindingOwners',
	'resolveFinding',
	'getAgentDevices',
	'getAgentDevice',
	'getAgentKeys',
	'getAgentKey',
];

const findingScopedOperations = [
	'getFinding',
	'getFindingComments',
	'addFindingComment',
	'assignFindingOwners',
	'resolveFinding',
	'getDetails',
	'get',
	'addComment',
	'assignOwners',
	'resolve',
	'getComments',
];

const agentDeviceScopedOperations = ['getAgentDevice', 'get'];

const agentKeyScopedOperations = ['getAgentKey', 'get'];

function addIfDefined(target: IDataObject, key: string, value: unknown) {
	if (value !== undefined && value !== null && value !== '') {
		target[key] = value as IDataObject;
	}
}

function addIfDefinedNonZeroNumber(target: IDataObject, key: string, value: unknown) {
	if (typeof value === 'number') {
		if (value !== 0) {
			target[key] = value;
		}
		return;
	}

	addIfDefined(target, key, value);
}

function buildPaginationParameters(options: IDataObject): IDataObject {
	const qs: IDataObject = {};
	addIfDefined(qs, 'order_by', options.orderBy);
	addIfDefined(qs, 'page', options.page);
	addIfDefined(qs, 'page_size', options.pageSize);
	return qs;
}

function buildFindingFilters(filters: IDataObject): IDataObject {
	const qs: IDataObject = {};
	addIfDefined(qs, 'blocked', filters.blocked);
	addIfDefinedNonZeroNumber(qs, 'category', filters.category);
	addIfDefined(qs, 'created_after', filters.createdAfter);
	addIfDefined(qs, 'created_before', filters.createdBefore);
	addIfDefined(qs, 'created_by', filters.createdBy);
	addIfDefined(qs, 'modified_after', filters.modifiedAfter);
	addIfDefined(qs, 'modified_before', filters.modifiedBefore);
	addIfDefined(qs, 'modified_by', filters.modifiedBy);
	addIfDefined(qs, 'name', filters.name);
	addIfDefinedNonZeroNumber(qs, 'priority', filters.priority);
	addIfDefinedNonZeroNumber(qs, 'resolution', filters.resolution);
	addIfDefinedNonZeroNumber(qs, 'status', filters.status);
	addIfDefined(qs, 'status_modified_by', filters.statusModifiedBy);
	addIfDefinedNonZeroNumber(qs, 'type', filters.type);
	return qs;
}

async function blumiraApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	qs: IDataObject = {},
	body: IDataObject = {},
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${endpoint}`,
		json: true,
	};

	if (Object.keys(qs).length) {
		options.qs = qs;
	}

	if (Object.keys(body).length) {
		options.body = body;
	}

	return this.helpers.httpRequestWithAuthentication.call(this, 'blumiraApi', options);
}

async function blumiraApiRequestAllItems(
	this: IExecuteFunctions,
	endpoint: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const returnData: IDataObject[] = [];
	const pageSize = typeof qs.page_size === 'number' ? (qs.page_size as number) : 50;
	let page = 1;

	while (true) {
		const responseData = await blumiraApiRequest.call(
			this,
			'GET',
			endpoint,
			{
				...qs,
				page,
				page_size: pageSize,
			},
		);

		const responseItems = (responseData.data ?? responseData) as IDataObject | IDataObject[];
		if (Array.isArray(responseItems)) {
			returnData.push(...responseItems);
		} else if (Object.keys(responseItems).length) {
			returnData.push(responseItems);
			break;
		}

		const nextLink = (responseData.links as IDataObject | undefined)?.next as
			| string
			| undefined;
		const itemsReturned = Array.isArray(responseItems) ? responseItems.length : 0;
		if (!nextLink || itemsReturned === 0) {
			break;
		}

		page += 1;
	}

	return returnData;
}

async function assertAccessToken(this: IExecuteFunctions, itemIndex: number) {
	const credentials = await this.getCredentials('blumiraApi');

	const accessToken = `${credentials.accessToken ?? ''}`.trim();

	if (!accessToken) {
		throw new NodeOperationError(
			this.getNode(),
			'Access token is required for this operation.',
			{ itemIndex },
		);
	}
}

function formatError(error: unknown): IDataObject {
	const formattedError: IDataObject = {
		message: error instanceof Error ? error.message : 'Unknown error',
	};

	if (typeof error === 'object' && error !== null) {
		const errorData = error as IDataObject;
		addIfDefined(formattedError, 'httpCode', errorData.httpCode);
		addIfDefined(formattedError, 'statusCode', errorData.statusCode);
		addIfDefined(formattedError, 'description', errorData.description);
		addIfDefined(formattedError, 'context', errorData.context);

		if (typeof errorData.response === 'object' && errorData.response !== null) {
			const responseData = errorData.response as IDataObject;
			addIfDefined(formattedError, 'responseStatus', responseData.status);
			addIfDefined(formattedError, 'responseStatusText', responseData.statusText);
			addIfDefined(formattedError, 'responseBody', responseData.body);
			addIfDefined(formattedError, 'responseData', responseData.data);
		}
	}

	return formattedError;
}

export class Blumira implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Blumira',
		name: 'blumira',
		icon: 'file:blumira.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the Blumira public API',
		defaults: {
			name: 'Blumira',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'blumiraApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account (MSP)',
						value: 'account',
					},
					{
						name: 'Agent Device (Org)',
						value: 'agentDevice',
					},
					{
						name: 'Agent Key (Org)',
						value: 'agentKey',
					},
					{
						name: 'Finding (Org)',
						value: 'finding',
					},
					{
						name: 'Health',
						value: 'health',
					},
				],
				default: 'finding',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['health'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get API health status',
						action: 'Get health status',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['account'],
					},
				},
				options: [
					{
						name: 'Add Finding Comment',
						value: 'addFindingComment',
						description: 'Add a comment to a finding for an MSP account',
						action: 'Add finding comment',
					},
					{
						name: 'Assign Finding Owners',
						value: 'assignFindingOwners',
						description: 'Assign owners to a finding for an MSP account',
						action: 'Assign finding owners',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a single MSP account',
						action: 'Get an account',
					},
					{
						name: 'Get Agent Device',
						value: 'getAgentDevice',
						description: 'Get an agent device for an MSP account',
						action: 'Get an agent device',
					},
					{
						name: 'Get Agent Devices',
						value: 'getAgentDevices',
						description: 'List agent devices for an MSP account',
						action: 'List agent devices',
					},
					{
						name: 'Get Agent Key',
						value: 'getAgentKey',
						description: 'Get an agent key for an MSP account',
						action: 'Get an agent key',
					},
					{
						name: 'Get Agent Keys',
						value: 'getAgentKeys',
						description: 'List agent keys for an MSP account',
						action: 'List agent keys',
					},
					{
						name: 'Get Finding',
						value: 'getFinding',
						description: 'Get a finding for an MSP account',
						action: 'Get a finding',
					},
					{
						name: 'Get Finding Comments',
						value: 'getFindingComments',
						description: 'List comments for an MSP account finding',
						action: 'Get finding comments',
					},
					{
						name: 'Get Findings',
						value: 'getFindings',
						description: 'List findings for an MSP account',
						action: 'List findings',
					},
					{
						name: 'Get Findings (All Accounts)',
						value: 'getFindingsAll',
						description: 'List findings across all MSP accounts',
						action: 'List findings for all accounts',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'List MSP accounts',
						action: 'List accounts',
					},
					{
						name: 'Resolve Finding',
						value: 'resolveFinding',
						description: 'Resolve a finding for an MSP account',
						action: 'Resolve finding',
					},
				],
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['agentDevice'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get an agent device',
						action: 'Get an agent device',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'List agent devices',
						action: 'List agent devices',
					},
				],
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['agentKey'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get an agent key',
						action: 'Get an agent key',
					},
					{
						name: 'Get Many',
						value: 'getMany',
						description: 'List agent keys',
						action: 'List agent keys',
					},
				],
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['finding'],
					},
				},
				options: [
					{
						name: 'Add Comment',
						value: 'addComment',
						description: 'Add a comment to a finding',
						action: 'Add comment to finding',
					},
					{
						name: 'Assign Owners',
						value: 'assignOwners',
						description: 'Assign owners to a finding',
						action: 'Assign finding owners',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a finding',
						action: 'Get a finding',
					},
					{
						name: 'Get Comments',
						value: 'getComments',
						description: 'List comments for a finding',
						action: 'Get finding comments',
					},
					{
						name: 'Get Details',
						value: 'getDetails',
						description: 'Get detailed finding data',
						action: 'Get finding details',
					},
					{
						name: 'Get Many',
						value: 'getManyFindings',
						description: 'List findings',
						action: 'List findings',
					},
					{
						name: 'Resolve',
						value: 'resolve',
						description: 'Resolve a finding',
						action: 'Resolve finding',
					},
				],
				default: 'getManyFindings',
			},
			{
				displayName: 'Account ID',
				name: 'accountId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the MSP account.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: accountScopedOperations,
					},
				},
			},
			{
				displayName: 'Finding ID',
				name: 'findingId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the finding.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['getFinding', 'getFindingComments', 'addFindingComment', 'assignFindingOwners', 'resolveFinding'],
					},
				},
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the device.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['getAgentDevice'],
					},
				},
			},
			{
				displayName: 'Key ID',
				name: 'keyId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the key.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['getAgentKey'],
					},
				},
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the device.',
				displayOptions: {
					show: {
						resource: ['agentDevice'],
						operation: agentDeviceScopedOperations,
					},
				},
			},
			{
				displayName: 'Key ID',
				name: 'keyId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the key.',
				displayOptions: {
					show: {
						resource: ['agentKey'],
						operation: agentKeyScopedOperations,
					},
				},
			},
			{
				displayName: 'Finding ID',
				name: 'findingId',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the finding.',
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: findingScopedOperations,
					},
				},
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['account', 'agentDevice', 'agentKey', 'finding'],
						operation: listOperations,
					},
				},
				description: 'Whether to return all results.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: {
					minValue: 1,
					maxValue: 5000,
				},
				displayOptions: {
					show: {
						resource: ['account', 'agentDevice', 'agentKey', 'finding'],
						operation: listOperations,
						returnAll: [false],
					},
				},
				description: 'Max number of results to return.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['account', 'agentDevice', 'agentKey', 'finding'],
						operation: listOperations,
					},
				},
				options: [
					{
						displayName: 'Order By',
						name: 'orderBy',
						type: 'string',
						default: '',
						description: 'Example: created;desc or name;asc',
					},
					{
						displayName: 'Page',
						name: 'page',
						type: 'number',
						default: 1,
						typeOptions: {
							minValue: 1,
						},
					},
					{
						displayName: 'Page Size',
						name: 'pageSize',
						type: 'number',
						default: 50,
						typeOptions: {
							minValue: 1,
							maxValue: 200,
						},
					},
				],
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: {
						resource: ['account', 'finding'],
						operation: findingsListOperations,
					},
				},
				options: [
			{
				displayName: 'Blocked',
				name: 'blocked',
				type: 'options',
				default: '',
				description: 'Filter by blocked status.',
				options: [
					{
						name: 'Any',
						value: '',
					},
					{
						name: 'True',
						value: true,
					},
					{
						name: 'False',
						value: false,
					},
				],
			},
					{
						displayName: 'Category ID',
						name: 'category',
						type: 'number',
				default: 0,
				typeOptions: {
					minValue: 1,
				},
					},
					{
						displayName: 'Created After',
						name: 'createdAfter',
						type: 'string',
						default: '',
						description: 'ISO 8601 timestamp.',
					},
					{
						displayName: 'Created Before',
						name: 'createdBefore',
						type: 'string',
						default: '',
						description: 'ISO 8601 timestamp.',
					},
					{
						displayName: 'Created By',
						name: 'createdBy',
						type: 'string',
						default: '',
						description: 'UUID of the creator.',
					},
					{
						displayName: 'Modified After',
						name: 'modifiedAfter',
						type: 'string',
						default: '',
						description: 'ISO 8601 timestamp.',
					},
					{
						displayName: 'Modified Before',
						name: 'modifiedBefore',
						type: 'string',
						default: '',
						description: 'ISO 8601 timestamp.',
					},
					{
						displayName: 'Modified By',
						name: 'modifiedBy',
						type: 'string',
						default: '',
						description: 'UUID of the modifier.',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Exact finding name.',
					},
					{
						displayName: 'Priority',
						name: 'priority',
						type: 'number',
				default: 0,
				typeOptions: {
					minValue: 1,
					maxValue: 5,
				},
						description: 'Priority number.',
					},
					{
						displayName: 'Resolution',
						name: 'resolution',
						type: 'number',
				default: 0,
				typeOptions: {
					minValue: 1,
				},
						description: 'Resolution ID.',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'number',
				default: 0,
				typeOptions: {
					minValue: 1,
				},
						description: 'Status ID.',
					},
					{
						displayName: 'Status Modified By',
						name: 'statusModifiedBy',
						type: 'string',
						default: '',
						description: 'UUID of the person who modified the status.',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'number',
				default: 0,
				typeOptions: {
					minValue: 1,
				},
						description: 'Type ID.',
					},
				],
			},
			// POST: Comment body
			{
				displayName: 'Comment Body',
				name: 'commentBody',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				description: 'Comment text. May contain HTML.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['addFindingComment'],
					},
				},
			},
			{
				displayName: 'Comment Body',
				name: 'commentBody',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				description: 'Comment text. May contain HTML.',
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: ['addComment'],
					},
				},
			},
			// POST: Sender UUID
			{
				displayName: 'Sender ID',
				name: 'sender',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the person creating the comment. Obtain from user endpoints.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['addFindingComment'],
					},
				},
			},
			{
				displayName: 'Sender ID',
				name: 'sender',
				type: 'string',
				default: '',
				required: true,
				description: 'UUID of the person creating the comment. Obtain from user endpoints.',
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: ['addComment'],
					},
				},
			},
			// POST: Owners (array of UUIDs)
			{
				displayName: 'Owner IDs',
				name: 'owners',
				type: 'string',
				default: '',
				required: true,
				description: 'Comma-separated list of person UUIDs to assign as owners. Send empty to clear owners for the specified type.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['assignFindingOwners'],
					},
				},
			},
			{
				displayName: 'Owner IDs',
				name: 'owners',
				type: 'string',
				default: '',
				required: true,
				description: 'Comma-separated list of person UUIDs to assign as owners. Send empty to clear owners for the specified type.',
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: ['assignOwners'],
					},
				},
			},
			// POST: Owner Type
			{
				displayName: 'Owner Type',
				name: 'ownerType',
				type: 'options',
				default: 'responder',
				required: true,
				description: 'Type of owners to assign.',
				options: [
					{
						name: 'Responder',
						value: 'responder',
					},
					{
						name: 'Analyst',
						value: 'analyst',
					},
					{
						name: 'Manager',
						value: 'manager',
					},
				],
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['assignFindingOwners'],
					},
				},
			},
			{
				displayName: 'Owner Type',
				name: 'ownerType',
				type: 'options',
				default: 'responder',
				required: true,
				description: 'Type of owners to assign.',
				options: [
					{
						name: 'Responder',
						value: 'responder',
					},
					{
						name: 'Analyst',
						value: 'analyst',
					},
					{
						name: 'Manager',
						value: 'manager',
					},
				],
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: ['assignOwners'],
					},
				},
			},
			// POST: Resolution
			{
				displayName: 'Resolution',
				name: 'resolution',
				type: 'options',
				default: 10,
				required: true,
				description: 'Resolution to apply to the finding.',
				options: [
					{
						name: 'Valid (10)',
						value: 10,
					},
					{
						name: 'False Positive (20)',
						value: 20,
					},
					{
						name: 'No Action Needed (30)',
						value: 30,
					},
					{
						name: 'Risk Accepted (40)',
						value: 40,
					},
				],
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['resolveFinding'],
					},
				},
			},
			{
				displayName: 'Resolution',
				name: 'resolution',
				type: 'options',
				default: 10,
				required: true,
				description: 'Resolution to apply to the finding.',
				options: [
					{
						name: 'Valid (10)',
						value: 10,
					},
					{
						name: 'False Positive (20)',
						value: 20,
					},
					{
						name: 'No Action Needed (30)',
						value: 30,
					},
					{
						name: 'Risk Accepted (40)',
						value: 40,
					},
				],
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: ['resolve'],
					},
				},
			},
			// POST: Resolution Notes (optional)
			{
				displayName: 'Resolution Notes',
				name: 'resolutionNotes',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Optional notes related to the resolution.',
				displayOptions: {
					show: {
						resource: ['account'],
						operation: ['resolveFinding'],
					},
				},
			},
			{
				displayName: 'Resolution Notes',
				name: 'resolutionNotes',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Optional notes related to the resolution.',
				displayOptions: {
					show: {
						resource: ['finding'],
						operation: ['resolve'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i += 1) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'health') {
					await assertAccessToken.call(this, i);
					const responseData = await blumiraApiRequest.call(this, 'GET', '/health');
					returnData.push({ json: responseData });
					continue;
				}

				await assertAccessToken.call(this, i);

				if (resource === 'account') {
					if (operation === 'getMany') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const qs = buildPaginationParameters(options);

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								'/msp/accounts',
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								'/msp/accounts',
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'get') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/msp/accounts/${accountId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'getFindingsAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const qs = {
							...buildPaginationParameters(options),
							...buildFindingFilters(filters),
						};

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								'/msp/accounts/findings',
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								'/msp/accounts/findings',
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'getFindings') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const qs = {
							...buildPaginationParameters(options),
							...buildFindingFilters(filters),
						};

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								`/msp/accounts/${accountId}/findings`,
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								`/msp/accounts/${accountId}/findings`,
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'getFinding') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const findingId = this.getNodeParameter('findingId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/msp/accounts/${accountId}/findings/${findingId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'getFindingComments') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const findingId = this.getNodeParameter('findingId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/msp/accounts/${accountId}/findings/${findingId}/comments`,
						);
						const responseItems = (responseData.data ?? responseData) as
							| IDataObject
							| IDataObject[];
						returnData.push(...this.helpers.returnJsonArray(responseItems));
					}

					if (operation === 'addFindingComment') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const findingId = this.getNodeParameter('findingId', i) as string;
						const commentBody = this.getNodeParameter('commentBody', i) as string;
						const sender = this.getNodeParameter('sender', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'POST',
							`/msp/accounts/${accountId}/findings/${findingId}/comments`,
							{},
							{
								body: commentBody,
								sender,
							},
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'assignFindingOwners') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const findingId = this.getNodeParameter('findingId', i) as string;
						const ownersRaw = this.getNodeParameter('owners', i) as string;
						const ownerType = this.getNodeParameter('ownerType', i) as string;
						const owners = ownersRaw
							.split(',')
							.map((o) => o.trim())
							.filter((o) => o.length > 0);
						const responseData = await blumiraApiRequest.call(
							this,
							'POST',
							`/msp/accounts/${accountId}/findings/${findingId}/assign`,
							{},
							{
								owners,
								owner_type: ownerType,
							},
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'resolveFinding') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const findingId = this.getNodeParameter('findingId', i) as string;
						const resolution = this.getNodeParameter('resolution', i) as number;
						const resolutionNotes = this.getNodeParameter('resolutionNotes', i, '') as string;
						const body: IDataObject = { resolution };
						if (resolutionNotes) {
							body.resolution_notes = resolutionNotes;
						}
						const responseData = await blumiraApiRequest.call(
							this,
							'POST',
							`/msp/accounts/${accountId}/findings/${findingId}/resolve`,
							{},
							body,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'getAgentDevices') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const qs = buildPaginationParameters(options);

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								`/msp/accounts/${accountId}/agents/devices`,
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								`/msp/accounts/${accountId}/agents/devices`,
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'getAgentDevice') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/msp/accounts/${accountId}/agents/devices/${deviceId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'getAgentKeys') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const qs = buildPaginationParameters(options);

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								`/msp/accounts/${accountId}/agents/keys`,
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								`/msp/accounts/${accountId}/agents/keys`,
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'getAgentKey') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const keyId = this.getNodeParameter('keyId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/msp/accounts/${accountId}/agents/keys/${keyId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					continue;
				}

				if (resource === 'agentDevice') {
					if (operation === 'getMany') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const qs = buildPaginationParameters(options);

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								'/org/agents/devices',
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								'/org/agents/devices',
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'get') {
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/org/agents/devices/${deviceId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					continue;
				}

				if (resource === 'agentKey') {
					if (operation === 'getMany') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const qs = buildPaginationParameters(options);

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								'/org/agents/keys',
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								'/org/agents/keys',
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'get') {
						const keyId = this.getNodeParameter('keyId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/org/agents/keys/${keyId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					continue;
				}

				if (resource === 'finding') {
					if (operation === 'getManyFindings') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const qs = {
							...buildPaginationParameters(options),
							...buildFindingFilters(filters),
						};

						if (returnAll) {
							const responseItems = await blumiraApiRequestAllItems.call(
								this,
								'/org/findings',
								qs,
							);
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const responseData = await blumiraApiRequest.call(
								this,
								'GET',
								'/org/findings',
								qs,
							);
							const responseItems = (responseData.data ?? responseData) as
								| IDataObject
								| IDataObject[];
							returnData.push(...this.helpers.returnJsonArray(responseItems));
						}
					}

					if (operation === 'get') {
						const findingId = this.getNodeParameter('findingId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/org/findings/${findingId}`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'getComments') {
						const findingId = this.getNodeParameter('findingId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/org/findings/${findingId}/comments`,
						);
						const responseItems = (responseData.data ?? responseData) as
							| IDataObject
							| IDataObject[];
						returnData.push(...this.helpers.returnJsonArray(responseItems));
					}

					if (operation === 'getDetails') {
						const findingId = this.getNodeParameter('findingId', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'GET',
							`/org/findings/${findingId}/details`,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'addComment') {
						const findingId = this.getNodeParameter('findingId', i) as string;
						const commentBody = this.getNodeParameter('commentBody', i) as string;
						const sender = this.getNodeParameter('sender', i) as string;
						const responseData = await blumiraApiRequest.call(
							this,
							'POST',
							`/org/findings/${findingId}/comments`,
							{},
							{
								body: commentBody,
								sender,
							},
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'assignOwners') {
						const findingId = this.getNodeParameter('findingId', i) as string;
						const ownersRaw = this.getNodeParameter('owners', i) as string;
						const ownerType = this.getNodeParameter('ownerType', i) as string;
						const owners = ownersRaw
							.split(',')
							.map((o) => o.trim())
							.filter((o) => o.length > 0);
						const responseData = await blumiraApiRequest.call(
							this,
							'POST',
							`/org/findings/${findingId}/assign`,
							{},
							{
								owners,
								owner_type: ownerType,
							},
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					if (operation === 'resolve') {
						const findingId = this.getNodeParameter('findingId', i) as string;
						const resolution = this.getNodeParameter('resolution', i) as number;
						const resolutionNotes = this.getNodeParameter('resolutionNotes', i, '') as string;
						const body: IDataObject = { resolution };
						if (resolutionNotes) {
							body.resolution_notes = resolutionNotes;
						}
						const responseData = await blumiraApiRequest.call(
							this,
							'POST',
							`/org/findings/${findingId}/resolve`,
							{},
							body,
						);
						const responseItem = (responseData.data ?? responseData) as IDataObject;
						returnData.push({ json: responseItem });
					}

					continue;
				}

				throw new NodeOperationError(
					this.getNode(),
					`The operation "${operation}" is not supported for resource "${resource}".`,
					{ itemIndex: i },
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: formatError(error),
						},
					});
					continue;
				}

				throw error;
			}
		}

		return [returnData];
	}
}
