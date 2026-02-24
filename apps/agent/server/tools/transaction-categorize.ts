export async function transactionCategorizeTool({ message }: { message: string; token?: string }) {
  return {
    categories: [{ category: 'INCOME', count: 1 }],
    input: message,
    source: 'agent_internal'
  };
}
