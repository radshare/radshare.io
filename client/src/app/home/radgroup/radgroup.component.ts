import { Component, OnInit } from '@angular/core';
import {RelicService} from '../../services/relic.service';
import {IRoom} from '../../../../../api/src/schema';

@Component({
  selector: 'app-radgroup',
  templateUrl: './radgroup.component.html',
  styleUrls: ['./radgroup.component.css']
})
export class RadgroupComponent implements OnInit {
  roomData: IRoom;
  usersArray: Array<{email: string, username: string}>;

  constructor(private relicsService: RelicService) { }

  ngOnInit(): void {
    this.relicsService.loadRoomDetails().subscribe(data => {
      this.roomData = data.result;
      this.usersArray = data.result.tenno;
    });
  }
  ngOnDestroy(): void {
    console.log('Deleting');
    this.relicsService.leaveRoom(this.roomData._id).toPromise().then(() => console.log('elp'));
  }
}
