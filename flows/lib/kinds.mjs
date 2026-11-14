// Single source of the task types that have a build flow. Used by the generator, the dispatcher and the flow event handlers.
export const BUILD_KINDS = ['feature', 'enhancement', 'bug'];
export const BUILD_FLOWS = BUILD_KINDS.map((kind) => `build_${kind}`);
