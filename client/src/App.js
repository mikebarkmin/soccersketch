import React from 'react';
import { Route, Switch } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import { t } from '@lingui/macro';
import HookedRouter from './components/HookedRouter';
import Navigation from './components/Navigation';
import DashboardPage from './pages/DashboardPage';
import { I18nProvider } from '@lingui/react';
import theme from './theme';
import GlobalStyle from './GlobalStyle';
import Root from './components/Root';

import dashboardIcon from './icons/dashboard.svg';

import useLocale from './hooks/useLocale';
import catalogs from './locales/catalogs';

const links = [
  {
    name: t`Dashboard`,
    url: '/',
    icon: dashboardIcon
  }
];

function App() {
  const { locale } = useLocale();
  return (
    <I18nProvider language={locale} catalogs={catalogs}>
      <ThemeProvider theme={theme}>
        <HookedRouter>
          <Root>
            <GlobalStyle />
            <Navigation links={links} />
            <Switch>
              <Route exact path="/" component={DashboardPage} />
            </Switch>
          </Root>
        </HookedRouter>
      </ThemeProvider>
    </I18nProvider>
  );
}

export default App;
