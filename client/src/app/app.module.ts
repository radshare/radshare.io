import { BrowserModule } from "@angular/platform-browser";
import { NgModule } from "@angular/core";

import { AppRoutingModule } from "./app-routing.module";
import { AppComponent } from "./app.component";
import { FormsModule } from "@angular/forms";
import { HttpClientModule } from "@angular/common/http";
import { ProfileComponent } from './profile/profile.component';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { RegisterComponent } from './register/register.component';
import {PasswordConfirmationValidator} from './passwordconfirmationvalidator.directive';
import { UniqueemailvalidatorDirective } from './uniqueemailvalidator.directive';

@NgModule({
  declarations: [
    AppComponent,
    ProfileComponent,
    LoginComponent,
    HomeComponent,
    RegisterComponent,
    PasswordConfirmationValidator,
    UniqueemailvalidatorDirective
  ],
  imports: [BrowserModule, AppRoutingModule, FormsModule, HttpClientModule],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
