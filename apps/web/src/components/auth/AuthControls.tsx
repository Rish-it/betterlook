'use client';

import Image from 'next/image';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Popover} from '@astryxdesign/core/Popover';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {colorVars} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import {getCredential, setOpenAIApiKey} from '@/lib/auth/client';
import type {ChatGPTIssue, ChatGPTStatus} from '@/lib/auth/status';
import chatGPTLogo from './chatgpt-logo-white.svg';

const styles = stylex.create({
  dialog: {
    backgroundColor: colorVars['--color-background-surface'],
    borderWidth: 0,
    boxShadow: 'none',
  },
  providerButton: {
    backgroundColor: {
      default: colorVars['--color-on-light'],
      ':hover': `color-mix(in srgb, ${colorVars['--color-on-light']}, ${colorVars['--color-on-dark']} 8%)`,
    },
    color: colorVars['--color-on-dark'],
    borderWidth: 0,
  },
  field: {
    backgroundColor: colorVars['--color-background-muted'],
    borderWidth: 0,
    boxShadow: 'none',
  },
  account: {minWidth: 0},
});

const issueMessages: Record<ChatGPTIssue, string> = {
  'consent-denied': 'ChatGPT plan access was declined. Connect again to allow access, or use an API key.',
  expired: 'Your ChatGPT session expired. Sign in again or use an API key.',
  revoked: 'ChatGPT plan access was revoked. Sign in again or use an API key.',
  'refresh-failed': 'Betterlook couldn’t renew your ChatGPT session. Sign in again or use an API key.',
  'provider-unavailable': 'ChatGPT is temporarily unavailable. Try again shortly or use an API key.',
  'sign-in-failed': 'Betterlook couldn’t verify your ChatGPT sign-in. Try again or use an API key.',
  'revocation-unconfirmed': 'You’re signed out of Betterlook. To confirm disconnection, open ChatGPT settings.',
  'not-configured': 'ChatGPT sign-in is unavailable here. Use an API key to continue.',
};

const sessionUrl = '/api/auth/chatgpt/session';

function takeCallbackIssue(): ChatGPTIssue | undefined {
  const url = new URL(window.location.href);
  const issue = url.searchParams.get('chatgpt');
  if (!issue || !Object.hasOwn(issueMessages, issue)) return;
  url.searchParams.delete('chatgpt');
  window.history.replaceState(window.history.state, '', url);
  return issue as ChatGPTIssue;
}

function connectionDescription(status: ChatGPTStatus | null, hasKey: boolean) {
  if (!status) return 'Checking ChatGPT sign-in…';
  if (status.status === 'signed-out') {
    return status.available ? 'Use your existing plan for eligible requests.' : 'ChatGPT sign-in is unavailable here.';
  }
  if (hasKey) return 'Requests use your API key while it’s added.';
  return status.planEnabled ? 'Eligible requests use your ChatGPT plan.' : 'ChatGPT plan access is off.';
}

function ChatGPTConnection({status, hasKey, issue, onSignOut}: {
  status: ChatGPTStatus | null;
  hasKey: boolean;
  issue: ChatGPTIssue | undefined;
  onSignOut: () => Promise<void>;
}) {
  const signedIn = status?.status === 'signed-in' ? status : null;
  const usesPlan = signedIn?.planEnabled && !hasKey;
  const maySignIn = status?.status === 'signed-out' && status.available;
  const showManageUsage = usesPlan || issue === 'revocation-unconfirmed';
  return (
    <VStack gap={2}>
      {signedIn ? (
        <HStack align="center" justify="between" gap={2}>
          <VStack gap={0} xstyle={styles.account}>
            <Text weight="semibold">ChatGPT</Text>
            <Text type="supporting" maxLines={1}>{signedIn.account}</Text>
          </VStack>
          <Button label="Sign out" size="sm" variant="ghost" clickAction={onSignOut} />
        </HStack>
      ) : (
        <form method="post" action="/api/auth/chatgpt/start">
          <Button
            data-oai-siwc-button=""
            type="submit"
            label="Continue with ChatGPT"
            variant="primary"
            width="100%"
            isDisabled={!maySignIn}
            xstyle={styles.providerButton}
            icon={<Image src={chatGPTLogo} alt="" width={16} height={16} unoptimized />}
          />
        </form>
      )}
      <Text type="supporting" role="status">
        {issue ? issueMessages[issue] : connectionDescription(status, hasKey)}
      </Text>
      {showManageUsage && (
        <Link href="https://chatgpt.com/settings/usage" type="supporting" isExternalLink>
          Manage usage
        </Link>
      )}
    </VStack>
  );
}

export function AuthControls() {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState<ChatGPTIssue>();
  const [hasKey, setHasKey] = useState(() => Boolean(getCredential()));
  const [draftKey, setDraftKey] = useState('');
  const pending = useRef<AbortController | null>(null);
  const signOutPending = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setIssue(undefined);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const requestStatus = useCallback(async (method: 'GET' | 'POST' = 'GET') => {
    if (method === 'GET' && signOutPending.current) return;
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    signOutPending.current = method === 'POST';

    try {
      const response = await fetch(sessionUrl, {method, signal: request.signal, cache: 'no-store'});
      if (!response.ok) throw new Error('Could not read the ChatGPT session.');
      const next: ChatGPTStatus = await response.json();
      if (request.signal.aborted) return;
      setStatus(next);

      const nextIssue = takeCallbackIssue() ?? next.issue;
      if (nextIssue) {
        setIssue(nextIssue);
        setOpen(true);
      } else if (method === 'POST') {
        close();
      }
    } catch {
      if (request.signal.aborted) return;
      setIssue('provider-unavailable');
      if (method === 'POST') setOpen(true);
    } finally {
      if (pending.current === request) {
        pending.current = null;
        signOutPending.current = false;
      }
    }
  }, [close]);

  useEffect(() => {
    void requestStatus();
    return () => pending.current?.abort();
  }, [requestStatus]);

  function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftKey.trim()) return;
    setOpenAIApiKey(draftKey);
    setDraftKey('');
    setHasKey(true);
    close();
  }

  const signedIn = status?.status === 'signed-in' ? status : null;
  const usesPlan = signedIn?.planEnabled && !hasKey;
  const trigger = hasKey ? 'OpenAI API key' : usesPlan ? 'Using ChatGPT plan' : 'Connect OpenAI';

  return (
    <Popover
      label="OpenAI access"
      alignment="end"
      width={328}
      padding={4}
      xstyle={styles.dialog}
      isOpen={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) void requestStatus();
        else {
          setDraftKey('');
          setIssue(undefined);
        }
      }}
      content={
        <VStack gap={4}>
          <ChatGPTConnection status={status} hasKey={hasKey} issue={issue} onSignOut={() => requestStatus('POST')} />

          {hasKey ? (
            <HStack align="center" justify="between" gap={2}>
              <Text type="supporting">API key added for this page.</Text>
              <Button
                label="Remove key"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpenAIApiKey('');
                  setHasKey(false);
                  close();
                }}
              />
            </HStack>
          ) : (
            <form onSubmit={saveKey}>
              <VStack gap={2}>
                <TextInput
                  label="OpenAI API key"
                  type="password"
                  autoComplete="off"
                  value={draftKey}
                  onChange={setDraftKey}
                  description="Kept in this page until you reload."
                  controlXstyle={styles.field}
                  width="100%"
                />
                <Button type="submit" label="Use API key" size="sm" isDisabled={!draftKey.trim()} />
              </VStack>
            </form>
          )}
        </VStack>
      }
    >
      <Button ref={triggerRef} label={trigger} size="sm" variant="ghost" />
    </Popover>
  );
}
