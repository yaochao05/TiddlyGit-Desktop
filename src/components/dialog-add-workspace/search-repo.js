// @flow
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useQuery } from 'graphql-hooks';

import TextField from '@material-ui/core/TextField';
import FolderIcon from '@material-ui/icons/Folder';
import LinearProgress from '@material-ui/core/LinearProgress';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';

import GitHubLogin from './github-login';
import type { IUserInfo } from './user-info';

const RepoSearchInput = styled(TextField)``;

const SEARCH_REPO_QUERY = `
  query SearchRepo($queryString: String!) {
    search(query: $queryString, type: REPOSITORY, first: 10) {
      repositoryCount
      edges {
        node {
          ... on Repository {
            name
            url
          }
        }
      }
    }
  }
`;

interface Props {
  accessToken: string | null;
  accessTokenSetter: (string | null) => void;
  githubWikiUrl: string;
  githubWikiUrlSetter: string => void;
  userInfo: IUserInfo;
  userInfoSetter: IUserInfo => void;
}
export default function SearchRepo({
  accessToken,
  accessTokenSetter,
  githubWikiUrl,
  githubWikiUrlSetter,
  userInfo,
  userInfoSetter,
}: Props) {
  const [githubRepoSearchString, githubRepoSearchStringSetter] = useState('wiki');
  const loadCount = 10;
  const githubUsername = userInfo?.login || '';
  const { loading, error, data } = useQuery(SEARCH_REPO_QUERY, {
    variables: {
      first: loadCount,
      queryString: `user:${githubUsername} ${githubRepoSearchString}`,
    },
    skipCache: true,
  });

  const repositoryCount = data?.search?.repositoryCount;
  let repoList = [];
  if (repositoryCount) {
    repoList = data.search.edges.map(({ node }) => node);
  }
  let helperText = '';
  if (!githubUsername || !accessToken) {
    helperText = '等待登录';
  } else if (error) {
    helperText = '无法加载仓库列表，网络不佳';
  }
  if (repositoryCount > loadCount) {
    helperText = `仅展示前${loadCount}个结果`;
  }

  return (
    <>
      <GitHubLogin
        clientId="7b6e0fc33f4afd71a4bb"
        clientSecret="6015d1ca4ded86b4778ed39109193ff20c630bdd"
        redirectUri="http://localhost"
        scope="repo"
        onSuccess={response => {
          const accessTokenToSet = response?.userInfo?.thirdPartyIdentity?.accessToken;
          const authDataString = response?.userInfo?.oauth;
          if (accessTokenToSet) {
            accessTokenSetter(accessTokenToSet);
          }
          // all data we need
          if (accessTokenToSet && authDataString) {
            const authData = JSON.parse(authDataString);
            const nextUserInfo = {
              ...response.userInfo,
              ...authData,
              ...response.userInfo.thirdPartyIdentity,
            };
            delete nextUserInfo.oauth;
            delete nextUserInfo.thirdPartyIdentity;
            userInfoSetter(nextUserInfo);
          }
        }}
        // eslint-disable-next-line unicorn/no-null
        onLogout={response => accessTokenSetter(null)}
        onFailure={response => console.log(response)}
      />
      <RepoSearchInput
        fullWidth
        onChange={event => {
          githubRepoSearchStringSetter(event.target.value);
        }}
        label="搜索Github仓库名"
        value={githubRepoSearchString}
        helperText={helperText}
      />
      {loading && <LinearProgress variant="query" />}
      <List component="nav" aria-label="main mailbox folders">
        {repoList.map(({ name, url }) => (
          <ListItem button key={url} onClick={() => githubWikiUrlSetter(url)} selected={githubWikiUrl === url}>
            <ListItemIcon>
              <FolderIcon />
            </ListItemIcon>
            <ListItemText primary={name} />
          </ListItem>
        ))}
      </List>
    </>
  );
}