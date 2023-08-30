export function stringifyError(error: Error) {
    return JSON.stringify(error, ['message', 'name', 'stack', 'arguments']);
  }