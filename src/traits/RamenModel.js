'use strict'

const QueryResolver = use('Ramen/QueryResolver')
const Database = use('Database')

class RamenModel {
  register (Model, customOptions = {}) {
    const defaultOptions = {
      relations: [],
      columns: []
    }
    const options = Object.assign(defaultOptions, customOptions)
    
    Model.createObject = async function (data, trx = null) {
      let genericModel = new Model()
      return await Model.saveObject(data, genericModel)
    }

    Model.updateObject = async function (id, data) {
      let genericModel = await Model.findOrFail(id)
      return await Model.saveObject(data, genericModel)
    }

    Model.saveObject = async function (data, genericModel) {
      const trx = await Database.beginTransaction()
      const columns = options.columns
      if (columns.length == 0) {
        return {error: {message: 'Model Error. Please define columns in your model'}}
      }

      columns.forEach(key => {
        if (data[key] != null) genericModel[key] = data[key]
      })
  
      try {
          await genericModel.save(trx)
          const result = await Model.saveRelations(data, genericModel,trx)
          if (result) {
            await trx.rollback()
            return {error: {message: result}}
          }
          await trx.commit()
          return {data: genericModel, error: {}}
      } catch (error){
        await trx.rollback()
        return {error: {message: 'POSTGRESQL ERROR. ' + error.message}}
      }
    }

    Model.saveRelations = async function (data, genericModel, trx) {
      const relations = options.relations
      if (relations.length == 0) {
        return
      }

      for (let i = 0; i < relations.length; i++) {
        const relation = relations[i]
        const relationData = data[relation.name]
        if (!relationData) {
          continue
        }
        
        switch(relation.type) {
          case 'belongsToMany':
            await genericModel[relation.name]().sync(relationData, trx)
            return
          case 'hasMany':
            let relationObjs = await genericModel[relation.name]().fetch()
            if (relationObjs.rows.length == 0) {
              try {
                for (const relationalData of relationData) {
                  await genericModel[relation.name]().create(relationalData, trx)
                }
                return
              }
              catch (error) {
                return 'POSTGRESQL ERROR. ' + error.message
              }
            }

            let dataHelper = {}
            for(const relationalData of relationObjs.rows) {
              dataHelper[relationalData.id] = relationalData
            }

            for (const data of relationData) {
              if (!data.id) {
                await genericModel[relation.name]().create(data, trx)
                continue
              }

              const relationalData = dataHelper[data.id]
              Object.keys(data).forEach(key => {
                relationalData[key] = data[key]
              })

              try {
                await relationalData.save(trx)
              }
              catch(error) {
                return 'POSTGRESQL ERROR. ' + error.message
              }
            }
            break
          default:
            let relationObj = await genericModel[relation.name]().fetch()
            if (!relationObj) {
              try {
                await genericModel[relation.name]().create(relationData, trx)
                continue
              }
              catch (error) {
                return 'POSTGRESQL ERROR. ' + error.message
              }
            }

            Object.keys(relationData).forEach(key => {
              relationObj[key] = relationData[key]
            })

            try {
              await relationObj.save(trx)
              continue
            }
            catch(error) {
              return 'POSTGRESQL ERROR. ' + error.message
            }
        }
      }
    }

    Model.upsert = async function (data) {
      try {
        if (data.id != null) {
          let genericModel = await Model.updateObject(data.id, data)

          if (genericModel.error.message != null){
            return {error: {message: genericModel.error.message}}
          }
          return {data: genericModel.data, error: {}}
        } else {
          let genericModel = await Model.createObject(data)

          if (genericModel.error.message != null){
            return {error: {message: genericModel.error.message}}
          }
          return {data: genericModel.data, error: {}}
        }
      } catch(error){
        return {error: {message: 'POSTGRESQL ERROR. ' + error.message}}
      }
    }

    Model.deleteData = async function (id) {
      try {
        const modelObj = await Model.findOrFail(id)
        await modelObj.delete()
        return {data: modelObj, error: {}}
      }
      catch(error) {
        return {error: {message: 'POSTGRESQL ERROR. ' + error.message}}
      }
    }

    Model.commonQueryBuilder = async function (builder, request){
      const queryParams = request.all()
      var reservedKeyword = ['orderBy', 'direction', 'page', 'limit', 'relations', 'lat', 'lng']

      for (let key in queryParams){
        if (key == 'relations'){
          QueryResolver.resolveRelations(builder, request.input('relations'))
        }
        else if (key == 'orderBy'){
          QueryResolver.resolveOrderBy(builder, request.input('orderBy', 'created_at'), request.input('direction', 'desc'))
        }
        else if (!reservedKeyword.includes(key)){
          QueryResolver.resolveWhere(builder, key, request.input(key))
        }
      }

      // handle pagination
      let defaultMeta = {
        message: 'data successfully retrieved'
      }

      if (queryParams.hasOwnProperty('page')){
        try {
          var queryData = await builder.paginate(request.input('page'), request.input('limit', 25))
          Object.keys(queryData.pages).forEach(pageElement => {
            defaultMeta[pageElement] = queryData.pages[pageElement]
          })
          return {data: queryData.rows, meta: defaultMeta, error: {}}
        } catch(error){
          return {error: {message: 'POSTGRESQL ERROR.' + error.message}}
        }
      }

      try {
        var queryData = await builder.fetch()
        return {data: queryData, meta: defaultMeta, error: {}}
      } catch(error){
        return {error: {message: 'POSTGRESQL ERROR. ' + error.message}}
      }
    }
  }
}

module.exports = RamenModel
