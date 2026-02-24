export function validateOutput(answer: string) {
  const hasAnswer = answer.trim().length > 0;

  return {
    errors: hasAnswer ? [] : ['empty_answer'],
    isValid: hasAnswer
  };
}
