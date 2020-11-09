import { Injectable } from '@angular/core';
import {Observable, of} from 'rxjs';
import {HttpClient} from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  constructor(private http: HttpClient) { }

  public checkEmail(email : string): Observable<any> {
    return this.http.get(`/api/register`, {params: {email: email}});
  }
}
