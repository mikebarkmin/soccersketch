import styled from 'styled-components';

const Root = styled.div`
  position: absolute;
  top: 80px;
  bottom: 30px;
  left: 0;
  right: 0;
  overflow-y: auto;

  @media (max-width: ${props => props.theme.mobileWidth}px) {
    top: 52px;
  }
`;

export default Root;
