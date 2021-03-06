
- [Type Definitions](#type-definitions)
	- [Custom directives you can use.](#custom-directives-you-can-use)
	- [Scalar Types](#scalar-types)
	- [Example](#example)
	- [Altering your schema and Migrations](#altering-your-schema-and-migrations)
		- [Special cases and scripting migrations](#special-cases-and-scripting-migrations)

## Type Definitions

**GraphQL Genie works off regular [GraphQL type defintions](https://graphql.org/learn/schema/) with some additional features**

GraphQL Genie supports interfaces and unions! You may want to look into using the `@storeName` [custom directive](#custom-directives-you-can-use) and see special concerns in [altering your schema](#altering-your-schema) when using them.

### Custom directives you can use.
 * **@unique**
	* The @unique directive marks a scalar field as unique. All id fields will be considered marked @unique
	* This is used for various update operations that need to find a unique field, errors will be thrown if a duplicate value is attempted to be added on a unique field
	* Currently GraphQL Genie does not automatically add indexes to unique fields in your database and it is recommended that you do this manually to improve performance.
*  **@relation(name: String)**
	*  The directive @relation(name: String) can be attached to a relation field
	*  Fields with relations will have referential integrity and inverse updates
	*  Genie will compute relations automatically (like between User and Address below) but if the relation is ambiguous the @relation directive should be used
	*  If a related object is delated, it's related nodes will be set to null
*  **@default(value: String!)**
	*  The directive @default(value: String!) sets a default value for a scalar field. 
	*  Note that the value argument is of type String for all scalar fields
*  **@connection**
	*  The directive @connection can be put on a list field to turn it into a type following the [Relay Cursor Connections Specification](https://facebook.github.io/relay/graphql/connections.htm) rather than just returning a normal list.
*  **@model**
	*  By default any object type will be part of the CRUD model, using the @model directive will limit to just types that use this directive
*  **@createdTimestamp (allowManual: Boolean = false)**
	*  The field will be automatically set when the record is created
	*  Must be of type DateTime
	*  If you want to also be able to allow the field to be set manually in mutations set allowManual to true
*  **@updatedTimestamp (allowManual: Boolean = false)**
	*  The field will automatically be updated when the record is updated
	*  Must be of type DateTime
	*  If you want to also be able to allow the field to be set manually in mutations set allowManual to true
*  **@storeName(value: String!)**
	*  If you want the actual name of the type in your backend store to be something other than based off the type name. Using this you can effectively rename your type without actually migrating any data
	*  Interfaces and Unions
		*  With Genie when using Interfaces and Unions only one actual backend store type will be created for an Interface/Union. For example if you had the interface `Animal` and two types `Dog` and `Cat` that implement it will create the actual store type `Animal_Cat_Dog`. The backend type is a alphabatized union separated by _. 
		*  If in the future you add a `Monkey` genie will then use `Animal_Cat_Dog_Monkey` as the store name, which would make you unable to access data created previously. In this case you want to use the @storeName directive and set it to `Animal_Cat_Dog`. Or if you predicted this possibility  you could set the store name on the interface to `Animal` and never worry about adding new types that implement that interface.
			*  `interface Animal @storeName(value:"Animal") {...`
	*  You can see your current store types by checking the `recordTypes` property from the store in your data resolver. `genie.getDataResolver().getStore().recordTypes`


### Scalar Types
In addition to the [default scalar types](https://graphql.org/learn/schema/#scalar-types) (Int, Float, String, Boolean, ID) GraphQL Genie comes built in with scalar fields Date, Time, DateTime ([learn more](https://www.npmjs.com/package/graphql-iso-date)) and JSON ([learn more](https://github.com/taion/graphql-type-json)).

### Example
```graphql 

interface Submission {
	id: ID! @unique
	text: String!
	author: User @relation(name: "SubmissionsByUser")
}

type Story implements Submission @model {
	id: ID! @unique
	title: String!
	text: String!
	author: User @relation(name: "SubmissionsByUser")
	likedBy: [User!] @connection @relation(name: "LikedSubmissions")
	createdAt: DateTime @createdTimestamp
	lastUpdatedAt: DateTime @updatedTimestamp
}

type Comment implements Submission @model {
	id: ID! @unique
	text: String!
	author: User @relation(name: "SubmissionsByUser")
	approved: Boolean @default(value: "true")
}

type User @model {
	id: ID! @unique
	email: String @unique
	submissions: [Submission!] @relation(name: "SubmissionsByUser")
	address: Address
	liked: [Submission!] @connection @relation(name: "LikedSubmissions")
}

type Address @model {
	id: ID! @unique
	city: String!
	user: User
}
```

### Altering your schema and Migrations


Adding types and fields to types or interfaces for example don't require any additional work, genie will take care of creating the necessary tables and fields.

Note that if you add a non-null field you may get errors querying that field on data that existed before that field existed (returning null on non null type) unless you update every record of that data to add a value first.

If you are adding a new type that implements an interface or is part of a union you may need to use the `@storeName` [custom directive](#custom-directives-you-can-use) in order to make sure your past data and new data are in the same place of your store.

If you are adding a single existing type to a new union or interface you will similarily have to use the `@storeName` [custom directive](#custom-directives-you-can-use).


#### Special cases and scripting migrations

You will need to script a migration of data in changes to field names/types or that result in data that is currently stored in multiple places needing to be stored under a single type. This is the case if you are:
* Changing a field name
* Changing a field type
* Adding an existing type to an existing interface or union
* Adding multiple existing types to a new or existing union or interface

One way to migrate the data
* Backup all your data in some way (you can use the [data export](https://github.com/genie-team/graphql-genie/blob/master/docs/GraphQLGenieAPI.md#getrawdata) function or query), just in case something goes wrong
	* Or do this in staging
* Create two genie objects, one with the old schema the new schema and no data
* [Export data](https://github.com/genie-team/graphql-genie/blob/master/docs/GraphQLGenieAPI.md#getrawdata) from the old schema genie by calling [`getRawData`](https://github.com/genie-team/graphql-genie/blob/master/docs/GraphQLGenieAPI.md#getrawdata) or using the [`exportData`](https://github.com/genie-team/graphql-genie/blob/master/docs/queries.md#export-data) mutation. Pass in the types that have been added to an interface or union.
* Make any alterations to the data that are necessary such as
	* Changing a field name or value 
	* Adding values to new non-null fields
* If the new schema is pointing to the same database, delete old type data (from types you exported) (you can use the [deleteMany mutation](https://github.com/genie-team/graphql-genie/blob/master/docs/mutations.md#updatemany-and-deletemany))
* [Import data](https://github.com/genie-team/graphql-genie/blob/master/docs/GraphQLGenieAPI.md#importrawdata) into the new schema genie by calling [`importRawData`](https://github.com/genie-team/graphql-genie/blob/master/docs/GraphQLGenieAPI.md#importrawdata) or using the [`importData`](https://github.com/genie-team/graphql-genie/blob/master/docs/mutations.md#import-data) mutation and pass in the result of the export.

