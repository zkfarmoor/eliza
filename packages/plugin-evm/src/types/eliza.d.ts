declare module '@ai16z/eliza' {
    export interface Plugin {
      name: string
      description?: string
      actions?: any[]
      evaluators?: any[]
      providers?: any[]
      services?: any[]
    }
  } 