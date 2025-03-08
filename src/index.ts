import { Context, Schema, Dict } from 'koishi'

export const name = 'calculator'
export const inject = ['database'] // 依赖数据库

declare module 'koishi' {
  interface Tables {
    calculator_values: CalculatorValue
  }
}

export interface CalculatorValue {
  id: string
  value: number
}

export interface Config {
  admins: string[]
  initialValue: number
  groupMappings: Record<string, string> // 记录群对映射，键是接收群，值是发送群
  showProcess: boolean // 是否显示计算过程
  independentMode: boolean // 是否启用每个群独立计算
}

export const Config: Schema<Config> = Schema.object({
  admins: Schema.array(String).description('允许使用计算功能的管理员ID列表'),
  initialValue: Schema.number().default(1).description('初始值'),
  groupMappings: Schema.dict(String).role('table').description('接收群 -> 发送群的映射'),
  showProcess: Schema.boolean().default(false).description('是否显示计算过程'),
  independentMode: Schema.boolean().default(false).description('是否启用每个群独立计算')
})

export async function apply(ctx: Context, config: Config) {
  ctx.model.extend('calculator_values', {
    id: 'string',
    value: 'float'
  }, {
    primary: 'id'
  })

  async function getGroupValue(groupId: string): Promise<number> {
    let record = await ctx.database.get('calculator_values', groupId)
    if (!record.length) {
      await ctx.database.create('calculator_values', { id: groupId, value: config.initialValue })
      return config.initialValue
    }
    return record[0].value
  }

  async function setGroupValue(groupId: string, value: number) {
    await ctx.database.upsert('calculator_values', [{ id: groupId, value }])
  }

  ctx.on('message', async (session) => {
    if (!config.admins.includes(session.userId)) return // 仅限管理员使用
    if (!config.groupMappings[session.guildId]) return // 该群不在映射表中

    const targetGroup = config.groupMappings[session.guildId] // 获取目标群 ID
    const msg = session.content.trim()
    const match = msg.match(/^([+\-*/xX÷])\s*(\d+(?:\.\d+)?)$/)
    if (!match) return // 不符合格式则忽略

    const operator = match[1]
    const num = parseFloat(match[2])

    // 确定当前计算的变量
    const groupId = session.guildId
    let value = await getGroupValue(config.independentMode ? groupId : 'global')
    let oldValue = value

    switch (operator) {
      case '+': value += num; break;
      case '-': value -= num; break;
      case '*': case 'x': case 'X': value *= num; break;
      case '/': case '÷': if (num !== 0) value /= num; else return session.send('除数不能为0'); break;
    }

    await setGroupValue(config.independentMode ? groupId : 'global', value)

    const resultMessage = config.showProcess
      ? `${oldValue} ${operator} ${num} = ${value}`
      : `当前值: ${value}`

    session.bot.sendMessage(targetGroup, resultMessage) // 发送到目标群
  })
}