import {Link} from 'react-router-dom';
import AccountSessionBoundary from './AccountSessionBoundary';
import AccountEnrollment from '../editor/AccountEnrollment';
import './account.css';
export default function AccountPage(){
 return <section className="account-page"><AccountSessionBoundary signedOutContent={<div className="account-signed-out"><Link className="primary" to="/login">ログインする</Link><Link to="/signup">初めての方は学生として登録する</Link></div>}>
  {({csrfToken,fetcher})=><AccountEnrollment csrfToken={csrfToken} fetcher={fetcher}/>}
 </AccountSessionBoundary><p className="account-read-link"><Link to="/">記事・作品を読む</Link></p></section>;
}
