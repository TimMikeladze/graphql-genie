import { SelectionNode, Kind, IntrospectionObjectType, GraphQLObjectType, isInputType, GraphQLSchema, GraphQLInputType, isListType, isNonNullType, GraphQLInterfaceType, GraphQLUnionType, GraphQLNonNull, GraphQLList, isUnionType, isObjectType, GraphQLID, isInterfaceType, IntrospectionType, GraphQLInputObjectType, GraphQLResolveInfo, GraphQLOutputType } from "graphql";
import { DataResolver } from "./GraphQLGenieInterfaces";
import { keys, each, get, merge, pickBy, endsWith, isEmpty, isArray, isObject, map } from 'lodash';

export const computeRelations = (schemaInfo: IntrospectionType[], nameResolver: (name:string) => string = (name:string) => name): Map<string, Map<string, string>> => {
	// relations is a map where key is the relation name and value is a map where the key is the type name and the value is the field name
	const relations = new Map<string, Map<string, string>>();
	each(keys(schemaInfo), (typeName) => {
		const type = schemaInfo[typeName];
		each(type.fields, field => {
			const relation = get(field, 'metadata.relation');
			if (relation) {
				let relationMap = relations.get(relation.name);
				relationMap = relationMap ? relationMap : new Map<string, string>();
				const name = nameResolver(typeName);
				if (relationMap.has(name) && relationMap.get(name) !== field.name) {
					console.error('Bad schema, relation could apply to multiple fields\n',
						'relation name', relation.name, '\n',
						'fortune name', name, '\n',
						'curr field', relationMap.get(name), '\n',
						'other field', field.name);

				}
				relationMap.set(name, field.name);
				relations.set(relation.name, relationMap);
			}
		});
	});
	return relations;
}

export const computeIncludes = (dataResolver: DataResolver, selection: SelectionNode, type: string, depth?: Array<any>) => {
	let includes = [];
	switch (selection.kind) {
		case Kind.FIELD:
			const link = dataResolver.getLink(type, selection.name.value);
			if (link) {
				type = link;
				const include = depth ? [...depth, [selection.name.value]] : [selection.name.value];
				depth = include;
				includes.push(include);
			}
			if (selection.selectionSet && (selection.selectionSet.selections.length > 0)) {
				includes = includes.concat(selection.selectionSet.selections
					.map(function (selectionNode) {
						return computeIncludes(dataResolver, selectionNode, type, depth);
					})
					.reduce(function (selections, selected) {
						return selections.concat(selected);
					}, []));
			}
			break;

		case Kind.INLINE_FRAGMENT:
			break;

		case Kind.FRAGMENT_SPREAD:
			break;


	}
	return includes;
}


const getInputName = (name: string): string => {
	return name + 'Input';
}

// We don't need a reference to the actual input type for the field to print correctly so just dummy it to prevent ifninite recursion

const generateInputs = (type: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType | GraphQLNonNull<any> | GraphQLList<any>, currInputObjectTypes: Map<string, GraphQLInputType>, schemaInfo: IntrospectionType[], schema: GraphQLSchema, dummy?: boolean): GraphQLInputType[] => {
	if (isListType(type)) {
		return [new GraphQLList(new GraphQLNonNull(generateInputs(type.ofType, currInputObjectTypes, schemaInfo, schema, dummy)[0])),
		new GraphQLList(new GraphQLNonNull(generateInputs(type.ofType, currInputObjectTypes, schemaInfo, schema, dummy)[1]))];
	} else if (isNonNullType(type)) {
		return [generateInputs(type.ofType, currInputObjectTypes, schemaInfo, schema, dummy)[0],
		generateInputs(type.ofType, currInputObjectTypes, schemaInfo, schema, dummy)[1]];
	} else {
		const fields = {};
		const name = getInputName(type.name);
		if (!dummy && !currInputObjectTypes.has(name)) {
			if (isUnionType(type)) {
				each(type.getTypes(), unionType => {
					merge(fields, generateFieldsForInput(
						getInputName(unionType.name),
						generateInputs(unionType, currInputObjectTypes, schemaInfo, schema, true)));

					if (!dummy) {
						generateInputs(unionType, currInputObjectTypes, schemaInfo, schema);
					}
				});
			} else if (isObjectType(type)) {
				each(type.getFields(), field => {
					if (field.name !== 'id') {
						merge(fields, generateFieldsForInput(
							field.name,
							isInputType(field.type) ? [field.type, GraphQLID] : generateInputs(field.type, currInputObjectTypes, schemaInfo, schema, true)));
					}
				});
			} else if (isInterfaceType(type)) {
				each(schemaInfo[type.name].possibleTypes, (possibleType) => {
					const schemaType = schema.getType(possibleType.name);

					merge(fields, generateFieldsForInput(
						possibleType.name,
						isInputType(schemaType) ? [schemaType, GraphQLID] : generateInputs(schemaType, currInputObjectTypes, schemaInfo, schema, true)));

					if (!isInputType(schemaType) && !dummy) {
						generateInputs(schemaType, currInputObjectTypes, schemaInfo, schema);
					}

				});
			}

			currInputObjectTypes.set(name, new GraphQLInputObjectType({
				name,
				fields
			}));
			// console.info(printType(newInputObjectTypes.get(name)));
		} else if (dummy) {
			return [new GraphQLInputObjectType({
				name: name,
				fields: {}
			}), GraphQLID];
		}
		return [currInputObjectTypes.get(name), GraphQLID];
	}
}


export const generateFieldsForInput = (fieldName: string, inputTypes: GraphQLInputType[], defaultValue?: string): object => {
	const fields = {};
	fields[fieldName] = {
		type: inputTypes[0],
		defaultValue: defaultValue
	};
	const idName = isListType(inputTypes[1]) ? fieldName + 'Ids' : fieldName + 'Id';
	fields[idName] = {
		type: inputTypes[1]
	};
	return fields;
}

const stripNonNull = (type: GraphQLOutputType ): GraphQLOutputType => {
	if (isNonNullType(type)) {
		return type.ofType;
	} else {
		return type;
	}
}

export const generateArgs = (type: IntrospectionObjectType, currArgs: Map<string, object>,
	currInputObjectTypes: Map<string, GraphQLInputType>,
	schemaInfo: IntrospectionType[], schema: GraphQLSchema, shouldStripNonNull?: boolean): object => {
	if (!currArgs.has(type.name)) {
		const args = {};
		const schemaType = <GraphQLObjectType>schema.getType(type.name);
		each(schemaType.getFields(), field => {
			if (field.name !== 'id') {
				if (isInputType(field.type)) {
					args[field.name] = {
						type: shouldStripNonNull ? stripNonNull(field.type) : field.type,
						defaultValue: get(type.fields.find((introField) => introField.name === field.name), 'metadata.defaultValue')
					};
				} else {
					// console.info('generate input for', field.type);
					merge(args, generateFieldsForInput(
						field.name,
						generateInputs(field.type, currInputObjectTypes, schemaInfo, schema)));

					// console.info(args.get(field.name));
				}
			}

		});

		currArgs.set(type.name, args);
	}

	return currArgs.get(type.name);
}

const getReturnType = (type: GraphQLOutputType): string => {
	if (isListType(type) || isNonNullType(type)) {
		return getReturnType(type.ofType);
	} else {
		return type.name;
	}
}

enum Mutation {
	create,
	update,
	unset
}


const mutateResolver = (mutation: Mutation, dataResolver: DataResolver) => {
	return async (_root: any, _args: { [key: string]: any }, _context: any, 	_info: GraphQLResolveInfo, key?: string, returnType?: GraphQLOutputType) => {
		// iterate over all the non-id arguments and recursively create new types
		const recursed = key ? true : false;
		if (!returnType) {
				returnType = _info.returnType;
		}


	
		const returnTypeName = getReturnType(returnType);

		if(mutation === Mutation.update) {
			const currValue = await dataResolver.find(returnTypeName, [_args['id']]);
			if (!currValue) {
				throw new Error(`${returnTypeName} does not have record with ID of ${_args['id']}`)
			}
		}
	
		const nonIdArgs = pickBy(_args, (__, key) => {
			return key !== 'id' && !endsWith(key, 'Id') && !endsWith(key, 'Ids');
		});
		if (isEmpty(nonIdArgs)) {
			throw new Error(`Bad Mutation\n You sent in an input argument with no new data, you probably want to use the key ${key}Id(s) instead of ${key} with only Id arguments`);
		}
		const argPromises = [];
		for (const argName in nonIdArgs) {
			let argReturnType: GraphQLOutputType;
			if ((isObjectType(returnType) || isInterfaceType(returnType)) && returnType.getFields()[argName]) {
				argReturnType = returnType.getFields()[argName].type;
			}
			const arg = _args[argName];
			if (isArray(arg)) {
				each(arg, currArgObj => {
					if (isObject(currArgObj) && argReturnType) {
						argPromises.push(mutateResolver(Mutation.create, dataResolver)(_root, currArgObj, _context, _info, argName, argReturnType));
						_args[argName] = [];
					}
				});
			} else if (isObject(arg) && argReturnType) {
				argPromises.push(mutateResolver(Mutation.create, dataResolver)(_root, arg, _context, _info, argName, argReturnType));
				_args[argName] = undefined;
			}
		}
		// wait for all the new types to be created
		const createdTypes = await Promise.all(argPromises);
	
		// setup the arguments to use the new types
		createdTypes.forEach(createdType => {
			const key = createdType.key;
			const id = createdType.id;
			if (isArray(_args[key])) {
				if (isArray(id)) {
					_args[key] = _args[key].concat(id);
				} else {
					_args[key].push(id);
				}
			} else {
				_args[key] = id;
			}
		});
	
		// now merge in the existing ids passed in
		const idArgs = pickBy(_args, (__, key) => {
			return endsWith(key, 'Id') || endsWith(key, 'Ids');
		});
		for (const argName in idArgs) {
			const arg = idArgs[argName];
			if (isArray(arg)) {
				const actualArgName = argName.replace('Ids', '');
				_args[actualArgName] = arg.concat(_args[actualArgName]);
			} else {
				const actualArgName = argName.replace('Id', '');
				if (_args[actualArgName]) {
					throw new Error(`Bad mutation\n Input argument contained multiple values for non array field with ${argName} and ${actualArgName}`);
				}
				_args[actualArgName] = arg;
			}
		}

		let dataResult;
		switch (mutation) {
			case Mutation.create:
				const includes = !recursed ? computeIncludes(dataResolver, _info.operation.selectionSet.selections[0], returnTypeName) : null;
				dataResult = await dataResolver.create(returnTypeName, _args, includes);
				break;
			
			case Mutation.update:

				dataResult = await dataResolver.update(returnTypeName, _args);
				break;		
		}

		let id;
		// if everything was an id no need to create anything new
		id = isArray(dataResult) ? map(dataResult, 'id') : dataResult.id;
	
		// if key this is recursed else it's the final value
		if (recursed) {
			return {key: key, id: id, created: dataResult};
		} else {
			return dataResult;
		}
	} 
}


export const createResolver = (dataResolver: DataResolver) => {
	return mutateResolver(Mutation.create, dataResolver);
}

export const updateResolver = (dataResolver: DataResolver) => {
	return mutateResolver(Mutation.update, dataResolver);
}
