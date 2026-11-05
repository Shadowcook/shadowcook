import { Component, type ComponentType, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { translations, type Locale } from '../../i18n';
import ErrorState from './ErrorState';

interface BoundaryProps {
  children: ReactNode;
  locale: Locale;
}
interface BoundaryState {
  failed: boolean;
}
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  public state: BoundaryState = { failed: false };
  public static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  public componentDidCatch(_error: Error, _info: ErrorInfo): void {
    console.error({ time: new Date().toISOString(), event: 'react-render-failed' });
  }
  public render(): ReactNode {
    return this.state.failed ? (
      <ErrorState text={translations[this.props.locale].errorStates} unexpected />
    ) : (
      this.props.children
    );
  }
}

export function withErrorBoundary<Props extends object>(
  View: ComponentType<Props>,
): ComponentType<Props> {
  return function GuardedView(properties: Props): JSX.Element {
    let locale: Locale = 'en';
    if ('locale' in properties && properties.locale === 'de') locale = 'de';
    if (
      'text' in properties &&
      typeof properties.text === 'object' &&
      properties.text !== null &&
      'locale' in properties.text &&
      properties.text.locale === 'de'
    )
      locale = 'de';
    return (
      <ErrorBoundary locale={locale}>
        <View {...properties} />
      </ErrorBoundary>
    );
  };
}
