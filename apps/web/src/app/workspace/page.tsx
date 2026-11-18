import {Workspace} from '../../workspace/Workspace';

const MOCK_PROMPT = 'Make the hero headline larger and center the sign-up button.';

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{prompt?: string; model?: string}>;
}) {
  const {prompt, model} = await searchParams;
  return <Workspace prompt={prompt?.trim() || MOCK_PROMPT} model={model ?? ''} />;
}
