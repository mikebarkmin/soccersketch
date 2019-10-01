import styled from 'styled-components';

const Main = styled.main`
  position: relative;
  display: block;
  padding: 24px;
  max-width: ${props => props.theme.maxWidth}px;
  margin-left: auto;
  margin-right: auto;
`;

export default Main;
